import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { createAssistantOwner } from '../src/assistant-owner.mjs'
import { createDesktopTts } from '../src/desktop-tts.mjs'

const root = process.env.DSH_SHARED_ASSISTANT_ROOT
test('one shared voice owner sends speech to the native Session and plays only new output', { skip: !root }, async () => {
  const { createAiuiAssistantRuntime } = await import(pathToFileURL(join(root, 'src/aiui-runtime.js')).href)
  const { createVoiceInteraction } = await import(pathToFileURL(join(root, 'src/voice-interaction.js')).href)
  const rounds = [], jobs = [], prompts = [], events = []
  let snapshot = { revision: 0 }, notify
  const eventSource = { getSnapshot: () => snapshot, subscribe: fn => { notify = fn; return () => { notify = null } } }
  const session = { beginSubmission: () => ({ requestId: 'input', abandon() {} }),
    prompt: async content => { prompts.push(content); return { ok: true, value: { accepted: true } } } }
  const sessions = { create: async () => 'native', retain: () => ({ ready: Promise.resolve({ session, eventSource }), release() {} }) }
  const asr = { createRound(handlers) { const round = { handlers }; rounds.push(round); return round },
    start(round) { round.handlers.onStart() }, stop() {} }
  const tts = { async synthesize(text) {
    const audio = new EventTarget()
    const job = { text, task: { abort() {} }, player: { audioPlayer: audio, play() {}, destroy() {} } }
    jobs.push(job); return job
  } }
  const resources = createAiuiAssistantRuntime({ asr, tts })
  let owner
  const voice = createVoiceInteraction({ runtime: resources, onInput: input => { void owner.accept(input.text) }, onEvent: event => events.push(event) })
  owner = createAssistantOwner({ sessions, voice, onError: error => { throw error } })
  await owner.open()
  voice.activate()
  rounds[0].handlers.onFinal({ text: 'hello' })
  for (let i = 0; i < 20 && !prompts.length; i++) await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(prompts, [[{ type: 'text', text: 'hello' }]])
  snapshot = { revision: 1, change: { kind: 'append', entries: [{ type: 'transient', event: { type: 'assistant/live-chunk',
    data: { attemptId: 'a', chunk: { type: 'text-delta', text: '你好。' } } } }] } }; notify()
  for (let i = 0; i < 20 && !jobs.length; i++) await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(jobs[0].text, '你好。')
  assert.equal(events.filter(event => event.type === 'input').length, 1)
  owner.close(); resources.dispose()
  assert.equal(notify, null)
})

test('speech onset pauses the desktop player through the shared voice owner', { skip: !root }, async () => {
  const { createAiuiAssistantRuntime } = await import(pathToFileURL(join(root, 'src/aiui-runtime.js')).href)
  const { createVoiceInteraction } = await import(pathToFileURL(join(root, 'src/voice-interaction.js')).href)
  let round, paused = 0, revoked = 0, played = 0
  class Audio extends EventTarget { play() { played++ } pause() { paused++ } removeAttribute() {} load() {} }
  const asr = { createRound(handlers) { round = { handlers }; return round }, start(value) { value.handlers.onStart() }, stop() {} }
  const tts = createDesktopTts({ requestAudio: async () => 'blob', createAudio: () => new Audio(), createUrl: () => 'url', revokeUrl: () => { revoked++ } })
  const runtime = createAiuiAssistantRuntime({ asr, tts })
  const voice = createVoiceInteraction({ runtime, onInput() {} })
  voice.activate()
  const reply = voice.beginResponse({ id:'reply' }); reply.append('你好。')
  for (let i = 0; i < 20 && !played; i++) await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(played, 1)
  round.handlers.onSpeechStart()
  assert.ok(paused > 0); assert.equal(revoked, 1)
  reply.append('旧结果继续。'); reply.finish()
  assert.equal(reply.getState().text, '你好。旧结果继续。')
  voice.dispose(); runtime.dispose()
})
