import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { speechContextProjection, recordSpeechContext, applySpeechContext } from '../src/speech-context.mjs'
import { createNativeSession } from '../src/native-session.mjs'
import { asrAgentContext } from './generated/speech-details.js'

const core = process.env.VOICE_TEST_DSH_CORE
if (!core) throw Error('VOICE_TEST_DSH_CORE required')
const { Session, SessionId } = await import(pathToFileURL(join(core, 'packages/core/session/lib/index.js')))
const { createUserMessage } = await import(pathToFileURL(join(core, 'packages/llm/llm/lib/index.js')))
const reduce = events => events.reduce(speechContextProjection.apply, speechContextProjection.init())

test('native Session keeps transcript human-facing while model input and replay retain the correct ASR result', () => {
  const session = Session.create(SessionId('speech-context-integration'))
  const observation = { source:'speech-recognition', provider:'volcengine', estimates:{emotion:'happy',age:'23.3',gender:'female'} }
  recordSpeechContext(session, 'request-1234', '你好', observation)
  const original = session.append('user/message', createUserMessage({content:[{type:'text',text:'你好'}],source:{kind:'user',rpcId:'request-1234'}}), {surfaceOp:'append'})
  const pending = reduce(session.snapshotEvents())
  applySpeechContext(session, pending)
  assert.equal(original.data.content[0].text, '你好')
  assert.deepEqual(JSON.parse(session.deriveMessages()[0].content[0].text).speechObservation, observation)
  assert.deepEqual(reduce(session.snapshotEvents()).pending, {})
  const restored = Session.create(session.id, session.snapshotEvents())
  assert.equal(restored.snapshotEvents().find(e => e.seq === original.seq).data.content[0].text, '你好')
  assert.deepEqual(JSON.parse(restored.deriveMessages()[0].content[0].text).speechObservation, observation)
  restored.append('user/message', createUserMessage({content:[{type:'text',text:'下一句'}],source:{kind:'user',rpcId:'request-5678'}}), {surfaceOp:'append'})
  assert.equal(restored.deriveMessages()[1].content[0].text, '下一句')
})

test('wrong input cannot receive an observation and pending recovery remains explicit', () => {
  const session = Session.create(SessionId('speech-context-mismatch'))
  recordSpeechContext(session, 'request-1234', 'original', {source:'speech-recognition',estimates:{emotion:'happy'}})
  session.append('user/message', createUserMessage({content:[{type:'text',text:'different'}],source:{kind:'user',rpcId:'request-1234'}}), {surfaceOp:'append'})
  assert.throws(() => reduce(session.snapshotEvents()), /SPEECH_CONTEXT_INPUT_MISMATCH/)
})

test('queued observations bind only to their own messages after recovery', () => {
  const session = Session.create(SessionId('speech-context-queue'))
  recordSpeechContext(session,'request-1111','one',{source:'speech-recognition',estimates:{emotion:'happy'}})
  recordSpeechContext(session,'request-2222','two',{source:'speech-recognition',estimates:{emotion:'sad'}})
  const restored = Session.create(session.id,session.snapshotEvents())
  restored.append('user/message',createUserMessage({content:[{type:'text',text:'two'}],source:{kind:'user',rpcId:'request-2222'}}),{surfaceOp:'append'})
  applySpeechContext(restored,reduce(restored.snapshotEvents()))
  assert.equal(JSON.parse(restored.deriveMessages()[0].content[0].text).speechObservation.estimates.emotion,'sad')
  restored.append('user/message',createUserMessage({content:[{type:'text',text:'one'}],source:{kind:'user',rpcId:'request-1111'}}),{surfaceOp:'append'})
  applySpeechContext(restored,reduce(restored.snapshotEvents()))
  assert.equal(JSON.parse(restored.deriveMessages()[1].content[0].text).speechObservation.estimates.emotion,'happy')
  assert.deepEqual(reduce(restored.snapshotEvents()).pending,{})
})

test('real projection registry drives pending observations and clears after replacement', async () => {
  const requireBoot = createRequire(pathToFileURL(join(core, 'packages/boot/app-boot/package.json')))
  const { Context } = await import(pathToFileURL(requireBoot.resolve('@deepseek-ai/cordis')))
  const { default: Store } = await import(pathToFileURL(join(core, 'packages/core/session/lib/index.js')))
  const { default: Registry } = await import(pathToFileURL(join(core, 'packages/session/session-projection/lib/index.js')))
  const ctx = new Context(); let handle
  try {
    await ctx.plugin(Store); await ctx.plugin(Registry)
    await ctx.plugin({ inject:['sessionProjections'], async apply(owner) { handle = await owner.sessionProjections.register(speechContextProjection) } })
    const session = ctx.sessions.create(SessionId('live-voice-projection'))
    recordSpeechContext(session, 'constructor', 'test', {source:'speech-recognition',estimates:{emotion:'happy'}})
    session.append('user/message', createUserMessage({content:[{type:'text',text:'test'}],source:{kind:'user',rpcId:'constructor'}}), {surfaceOp:'append'})
    const reader = handle.readerFor(session)
    assert.equal(Object.keys(reader().pending).length, 1)
    applySpeechContext(session, reader())
    assert.deepEqual(reader().pending, {})
    assert.equal(JSON.parse(session.deriveMessages()[0].content[0].text).speechObservation.estimates.emotion, 'happy')
  } finally { await ctx.fiber.dispose() }
})

test('real DSH agent sends utterance observations to the model and retains them on the next turn', async () => {
  const bootRequire = createRequire(pathToFileURL(join(core, 'packages/boot/app-boot/package.json')))
  const { Context } = await import(pathToFileURL(bootRequire.resolve('@deepseek-ai/cordis')))
  const load = async path => import(pathToFileURL(join(core, 'packages', path, 'lib/index.js')))
  const [llm, store, registry, system, tools, executor, agents, loop] = await Promise.all([
    load('llm/llm'), load('core/session'), load('session/session-projection'), load('core/system-prompt'),
    load('core/tools'), load('core/tool-executor-native'), load('core/agent'), load('core/agent-loop'),
  ])
  class Adapter extends llm.LlmAdapter {
    requests = []
    async resolveModel(provider, model) { return {provider,id:model,name:model} }
    async *stream(options) {
      this.requests.push(options)
      yield {type:'block-start',index:0,blockType:'text'}
      yield {type:'text-delta',index:0,text:'ok'}
      yield {type:'block-end',index:0,block:{type:'text',text:'ok'}}
      yield {type:'usage',usage:{inputTokens:10,outputTokens:2}}
      yield {type:'finish',reason:{kind:'stop'}}
    }
  }
  const ctx = new Context(), adapter = new Adapter(); let handle
  const idle = agent => new Promise(resolve => { const off = ctx.on('agent/status', ({agent:subject,status}) => { if (subject === agent && status === 'idle') { off(); resolve() } }) })
  try {
    for (const plugin of [llm.default,store.default,registry.default,system.default,tools.default,executor,agents.default]) await ctx.plugin(plugin)
    await ctx.plugin(loop.default,{agents:[]}); ctx.llm.registerAdapter(['mock'],adapter)
    await ctx.plugin({inject:['sessionProjections'],async apply(owner){handle=await owner.sessionProjections.register(speechContextProjection)}})
    const agent = await ctx.agentLoop.create(SessionId('speech-model-input'),{provider:'mock',model:'mock'})
    const sessionController = {
      async resolveAgent(id) { assert.equal(id,agent.id); return {agent} },
      async prompt(request) { agent.followup(createUserMessage({content:request.content,source:{kind:'user',rpcId:request.requestId}})); return {accepted:true} },
    }
    const native = createNativeSession({on:ctx.on.bind(ctx),sessionController}, {
      settings:()=>({persona:'Assistant'}), binding:{get:()=>({sessionId:agent.id})}, speechContext:handle,
      asrAgentContext,
    })
    let settled = idle(agent)
    await native.submit('你好','request-1234',{source:'speech',details:{kind:'asr',provider:'volcengine',model:'bigmodel',result:{additions:{emotion:'happy',age:'23.3',log_id:'fixture-private-log'}},request:{headers:{authorization:'fixture-private-key'}}}})
    await settled
    assert.equal(JSON.parse(adapter.requests[0].messages.find(message => message.role === 'user').content[0].text).speechObservation.estimates.emotion, 'happy')
    assert.doesNotMatch(JSON.stringify(adapter.requests[0].messages), /fixture-private/)
    assert.match(JSON.stringify(adapter.requests[0].messages), /23\.3/)
    settled = idle(agent)
    agent.followup(createUserMessage({content:[{type:'text',text:'下一句'}],source:{kind:'user',rpcId:'request-5678'}}))
    await settled
    assert.match(JSON.stringify(adapter.requests[1].messages), /23\.3/)
    const original = agent.session.snapshotEvents().find(event=>event.type==='user/message' && event.surfaceOp==='append')
    assert.equal(original.data.content[0].text,'你好')
    native.close()
  } finally { await ctx.fiber.dispose() }
})
