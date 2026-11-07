import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { join } from 'node:path'

const root = process.env.DSH_SHARED_ASSISTANT_ROOT
async function loadAssistant() {
  const entries = { '@rabilink/assistant-runtime/aiui': join(root, 'src/aiui-runtime.js'),
    '@rabilink/assistant-runtime/voice': join(root, 'src/voice-interaction.js') }
  const bundle = await build({ entryPoints: ['src/desktop-assistant.mjs'], bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'shared-sdk', setup(builder) { builder.onResolve({ filter: /^@rabilink\// }, args => ({ path: entries[args.path] })) } }] })
  return (await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)).createDesktopAssistant
}
test('GUI and optional presenter observe one native Session and one shared voice owner', { skip: !root }, async () => {
  const createDesktopAssistant = await loadAssistant()
  const rounds = [], prompts = []
  let snapshot = { revision: 0 }, notify
  const source = { getSnapshot: () => snapshot, subscribe: fn => { notify=fn; return () => {} } }
  const session = { beginSubmission: () => ({ requestId: 'input', abandon() {} }),
    async prompt(content) { prompts.push(content); return { ok: true, value: { accepted: true } } } }
  let creates = 0
  const sessions = { async create() { creates++; return 'one' }, retain: () => ({ ready: Promise.resolve({ session, eventSource: source }), release() {} }) }
  const asr = { createRound(handlers) { const round = { handlers }; rounds.push(round); return round }, start(round) { round.handlers.onStart() }, stop() {} }
  const tts = { async synthesize() { throw Error('not requested') } }
  const assistant = createDesktopAssistant({ sessions, asr, tts, maxVisibleMessages:100, onError: error => { throw error } })
  let gui = 0, pet = 0
  const unGui = assistant.subscribe(() => { gui++ }), unPet = assistant.subscribe(() => { pet++ })
  await assistant.open(); assistant.activate(); rounds[0].handlers.onFinal({ text: 'hello' })
  for (let i = 0; i < 20 && !prompts.length; i++) await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(creates, 1); assert.equal(rounds.length, 1); assert.equal(prompts.length, 1)
  const entry = (attemptId, text) => ({ type:'transient', event:{ type:'assistant/live-chunk',
    data:{ attemptId, turn:1, step:1, chunk:{ type:'text-delta', text } } } })
  snapshot = { revision:1, change:{ kind:'append', entries:[entry('a','old')] } }; notify()
  snapshot = { revision:2, change:{ kind:'append', entries:[entry('b','new')] } }; notify()
  snapshot = { revision:3, change:{ kind:'append', entries:[entry('a',' continued')] } }; notify()
  assert.equal(assistant.getSnapshot().messages.find(item => item.id === 'assistant:a').text, 'old continued')
  assert.equal(assistant.getSnapshot().messages.find(item => item.id === 'assistant:b').text, 'new')
  assert.ok(gui > 0 && pet > 0); unPet(); unGui(); assistant.close()
})

test('a late submission failure after close does not notify subscribers or report into the closed view', { skip: !root }, async () => {
  const createDesktopAssistant = await loadAssistant()
  let reject, started, notices = 0, errors = 0
  const began = new Promise(resolve => { started = resolve })
  const pending = new Promise((_, fail) => { reject = fail })
  const session = { beginSubmission: () => ({ requestId:'input', abandon() {} }), prompt() { started(); return pending } }
  const eventSource = { getSnapshot: () => ({ revision: 0 }), subscribe: () => () => {} }
  const sessions = { async create() { return 'one' }, retain: () => ({ ready: Promise.resolve({ session, eventSource }), release() {} }) }
  const asr = { createRound() { return {} }, start() {}, stop() {} }
  const tts = { async synthesize() { throw Error('not requested') } }
  const assistant = createDesktopAssistant({ sessions, asr, tts, maxVisibleMessages:100, onError: () => { errors++ } })
  assistant.subscribe(() => { notices++ })
  await assistant.open(); assistant.send('task'); await began
  assistant.close()
  const afterClose = notices
  reject(new Error('late failure'))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(notices, afterClose); assert.equal(errors, 0)
})
