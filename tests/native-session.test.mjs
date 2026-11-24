import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeSession } from '../src/native-session.mjs'
function fixture(saved={}, initialSections=[{name:'deployment:persona-prefix',text:'preset persona',order:40},{name:'tool:existing',text:'native tools',order:110}]) {
  const listeners=new Map(),sections=new Map(),hooks=new Map(),calls=[];let config={persona:'first'}
  const agent={id:saved.sessionId,status:'idle',inbox:{nextTurn:[],nextStep:[]},runMaintenance:async fn=>fn(new AbortController().signal),ctx:{systemPrompt:{async assemble(){
    const initial={sections:initialSections,contexts:[],variables:{}}
    return hooks.get('system-prompt/assemble')?.(initial,{},async()=>initial)??initial
  }},on(name,fn){hooks.set(name,fn);return()=>hooks.delete(name)}}}
  const ctx={on(name,fn){listeners.set(name,fn);return()=>listeners.delete(name)},sessionController:{
    async create(args){calls.push(args);agent.id=args.sessionId;return {sessionId:args.sessionId}},
    async resolveAgent(id){assert.equal(id,agent.id);return {agent}},
    async state(){return {active:true,running:false,queue:[],pendingInput:[]}},
    async prompt(args,signal){calls.push({prompt:args,signal});return {accepted:true}},
  }}
  const binding={get:()=>saved,async set(value){saved=value}}
  const create=options=>createNativeSession(ctx,{settings:()=>config,binding,...options})
  const session=create()
  return {session,create,calls,sections,hooks,listeners,binding,agent,setConfig:value=>{config=value}}
}
test('new Session uses native default preset and restores the same durable identity',async()=>{
  const f=fixture();const [id,again]=await Promise.all([f.session.open(),f.session.open()]);assert.equal(id,again)
  assert.equal(f.calls.length,1);assert.equal('agentPreset' in f.calls[0],false)
  const saved=f.binding.get();f.session.close();const next=fixture(saved);await next.session.open();assert.equal(next.calls.length,0)
  next.session.close()
})
test('persona updates at a new native turn, keeps tool steps in the original persona',async()=>{
  const f=fixture();await f.session.open();const hook=f.hooks.get('agent/request-context');let next=0
  await hook({agent:f.agent,turn:1},async()=>{next++})
  f.setConfig({persona:'second'})
  await hook({agent:f.agent,turn:1},async()=>{next++})
  assert.equal((await f.agent.ctx.systemPrompt.assemble()).sections[0].text,'first')
  await hook({agent:f.agent,turn:2},async()=>{next++})
  assert.equal((await f.agent.ctx.systemPrompt.assemble()).sections[0].text,'second');assert.equal(next,3)
  assert.equal((await f.agent.ctx.systemPrompt.assemble()).sections[1].text,'native tools')
  f.session.close();assert.equal(f.hooks.size,0)
})
test('failed native tool attachment rolls back scoped hooks and retries the installation',async()=>{
  const f=fixture({sessionId:'saved'});f.session.close();let installs=0,removed=0
  const session=f.create({installTools(){if(++installs===1)throw Error('TOOL_ATTACH_FAILED');return()=>{removed++}}})
  await assert.rejects(session.open(),/TOOL_ATTACH_FAILED/);assert.equal(f.hooks.size,0)
  await session.open();assert.equal(installs,2);assert.equal(f.hooks.size,2)
  session.close();assert.equal(removed,1);assert.equal(f.hooks.size,0)
})
test('disposing voice-facing binding does not cancel admitted native work',async()=>{
  const f=fixture();await f.session.submit('do work','request-1234');const admitted=f.calls.at(-1)
  f.session.close();assert.equal(admitted.signal.aborted,false);assert.equal(admitted.prompt.mode,'queue')
  assert.equal(f.listeners.size,0)
})
test('close during prompt assembly rejects attachment and releases each hook once',async()=>{
  const f=fixture({sessionId:'saved'});f.session.close();let resolveAssembly,removed=0
  f.agent.ctx.systemPrompt.assemble=()=>new Promise(resolve=>{resolveAssembly=resolve})
  const session=f.create({installTools:()=>()=>{removed++}})
  const pending=session.open()
  while(!resolveAssembly) await new Promise(resolve=>setImmediate(resolve))
  session.close();resolveAssembly({sections:[{name:'voice-assistant:persona',text:'first'}]})
  await assert.rejects(pending,/ASSISTANT_CLOSED/)
  assert.equal(removed,1);assert.equal(f.hooks.size,0);assert.equal(f.listeners.size,0)
})
test('voice instruction and enabled capability snapshot join the native prompt without changing persona',async()=>{
  const f=fixture();f.session.close()
  const session=f.create({speechInstruction:' [voice]',speechPolicy:()=>({enabled:true,fields:[{id:'rate'}]})})
  await session.open()
  const prompt=await f.agent.ctx.systemPrompt.assemble()
  assert.equal(prompt.sections[0].text,'first [voice]')
  assert.equal(prompt.sections[0].order,40)
  assert.deepEqual(JSON.parse(prompt.contexts[0].text),{speechCapabilities:{enabled:true,fields:[{id:'rate'}]}})
  await f.hooks.get('agent/request-context')({agent:f.agent,turn:1},async()=>{})
  assert.equal(session.getSpeechPolicy(1).enabled,true)
  session.close()
})
test('uses the native persona prefix order when adding a new prompt section',async()=>{
  const f=fixture({},[{name:'tool:existing',text:'native tools',order:110}])
  f.agent.ctx.systemPrompt.getSectionOrder=name=>{assert.equal(name,'DEPLOYMENT_PERSONA_PREFIX');return 10}
  await f.session.open()
  const expected={name:'voice-assistant:persona',text:'first',order:10,interpolate:false}
  assert.deepEqual((await f.agent.ctx.systemPrompt.assemble()).sections[0],expected)
  delete f.agent.ctx.systemPrompt.getSectionOrder
  assert.deepEqual((await f.agent.ctx.systemPrompt.assemble()).sections[0],{...expected,order:0})
  f.session.close()
})
test('recognition context uses only the latest visible assistant text in the current native session',async()=>{
  const f=fixture();f.session.close()
  const events=new Map([[1,{type:'assistant/message',data:{message:{content:[{type:'text',text:'旧回复'}]}}}],
    [2,{type:'tool/result',data:{message:{content:[{type:'text',text:'工具私有数据'}]}}}],
    [3,{type:'assistant/message',data:{message:{content:[{type:'reasoning',text:'内部推理'},{type:'text',text:'<voice rate="1"/>当前回复'}]}}}]])
  f.agent.session={surface:{nodes:[1,2,3]},eventAt:seq=>events.get(seq),deriveEventMessage:event=>({...event.data.message,role:'assistant'})}
  const session=f.create({createDecoder:()=>({push(value){this.value=value.replace(/^<voice[^>]*\/>/,'')},finish(){return {text:this.value}}})})
  await session.open()
  assert.deepEqual(session.recognitionContext(),[{role:'assistant',text:'当前回复'}])
  f.agent.session.deriveEventMessage=()=>({role:'assistant',content:[{type:'text',text:'经会话投影的回复'}]})
  assert.deepEqual(session.recognitionContext(),[{role:'assistant',text:'经会话投影的回复'}])
  f.agent.session.deriveEventMessage=event=>({...event.data.message,role:'assistant'})
  events.set(3,{type:'assistant/message',data:{message:{content:[{type:'text',text:'api_key=abcdefghijklmnop'}]}}})
  assert.deepEqual(session.recognitionContext(),[])
  session.close();assert.deepEqual(session.recognitionContext(),[])
})
test('speech details stay outside native model input and associate playback with its original step',async()=>{
  const f=fixture();f.session.close()
  const session=f.create({safeDetails:value=>JSON.parse(JSON.stringify(value, (key,item)=>key==='token'?'[hidden]':item))})
  await session.submit('说句话','request-1234',{source:'speech',details:{kind:'asr',result:{emotion:'happy',token:'secret'}}})
  assert.deepEqual(f.calls.at(-1).prompt.content,[{type:'text',text:'说句话'}])
  assert.equal(session.messageDetails('u:request-1234').result.token,'[hidden]')
  const stream=f.listeners.get('agent/assistant-stream')
  stream({agent:f.agent,frame:{type:'start',attemptId:'reply-1',turn:2,step:3}})
  assert.equal(session.getSpeechMessageId('reply-1'),'a:2:3')
  assert.equal(session.getSpeechMessageId('unknown'),undefined)
  session.updateSpeechText('reply-1','你好')
  session.recordSpeechDetails('reply-1',{type:'request',requestId:'one',status:'sent',token:'secret'})
  session.recordSpeechDetails('reply-1',{type:'request',requestId:'one',status:'finished'})
  for(let i=2;i<=6;i++)session.recordSpeechDetails('reply-1',{type:'request',requestId:String(i)})
  session.recordSpeechDetails('reply-1',{type:'playback',status:'ended'})
  const result=session.messageDetails('a:2:3')
  assert.equal(result.message.text,'你好');assert.equal(result.requestCount,6);assert.equal(result.requests.length,4)
  assert.equal(result.playback.status,'ended');assert.deepEqual(session.detailIndex(),['u:request-1234','a:2:3'])
  session.close();assert.throws(()=>session.messageDetails('a:2:3'),/UNAVAILABLE/)
})
test('speech detail retention evicts the oldest of more than 100 messages',async()=>{
  const f=fixture()
  for(let n=0;n<101;n++)await f.session.submit('test','request-'+String(n).padStart(4,'0'),{source:'speech',details:{kind:'asr'}})
  assert.equal(f.session.detailIndex().length,100)
  assert.throws(()=>f.session.messageDetails('u:request-0000'),/UNAVAILABLE/)
  assert.equal(f.session.messageDetails('u:request-0100').kind,'asr')
  f.session.close()
})
test('explicit clear switches the durable native session without deleting the old one',async()=>{
  const f=fixture();const old=await f.session.open()
  assert.equal(f.session.contextState().busy,false)
  await assert.rejects(f.session.clearContext('stale'),/CONTEXT_STALE/)
  const next=await f.session.clearContext(old)
  assert.notEqual(next,old);assert.equal(f.binding.get().sessionId,next)
  assert.equal(f.calls.filter(call=>call.sessionId===old).length,1)
  assert.equal(f.calls.filter(call=>call.sessionId===next).length,1)
  f.session.close()
})
test('clear refuses pending native input and keeps its original session',async()=>{
  const f=fixture();const old=await f.session.open();f.agent.inbox.nextTurn.push({})
  assert.equal(f.session.contextState().busy,true)
  await assert.rejects(f.session.clearContext(old),/CONTEXT_BUSY/)
  assert.equal(f.binding.get().sessionId,old);assert.equal(f.calls.length,1)
  f.session.close()
})
test('clear restores its old binding when input arrives during persistence',async()=>{
  const f=fixture(),old=await f.session.open(),set=f.binding.set
  f.binding.set=async value=>{await set(value);if(value.sessionId!==old)f.agent.inbox.nextTurn.push({})}
  await assert.rejects(f.session.clearContext(old),/CONTEXT_BUSY/)
  assert.equal(f.binding.get().sessionId,old);assert.equal(f.session.getSessionId(),old)
  f.session.close()
})
test('uncertain binding writes fence later submissions',async()=>{
  const f=fixture(),old=await f.session.open()
  f.binding.set=async()=>{throw Error('WRITE_UNKNOWN')}
  await assert.rejects(f.session.clearContext(old),/CONTEXT_SWITCH_UNCONFIRMED/)
  assert.equal(f.session.contextState().status,'failed')
  await assert.rejects(f.session.submit('hello','request-1234'),/CONTEXT_SWITCH_UNCONFIRMED/)
  f.session.close()
})
