import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAssistantOwner } from '../src/assistant-owner.mjs'

test('shares one native Session and treats the response as admission only', async () => {
  let creates = 0, releases = 0, prompts = 0, disposed = 0
  const events = { getSnapshot: () => ({ revision: 0 }), subscribe: () => () => {} }
  const session = { beginSubmission: () => ({ requestId: 'input', abandon() {} }), prompt: async () => { prompts++; return { ok: true, value: { accepted: true } } } }
  const sessions = { async create() { creates++; return 'assistant' }, retain() { return { ready: Promise.resolve({ session, eventSource: events }), release() { releases++ } } } }
  const voice = { beginResponse() {}, dispose() { disposed++ } }
  const owner = createAssistantOwner({ sessions, voice, onError() {} })
  assert.equal((await owner.accept('hello')).value.accepted, true)
  await owner.accept('again')
  assert.equal(creates, 1); assert.equal(prompts, 2)
  owner.close(); owner.close()
  assert.equal(releases, 1); assert.equal(disposed, 1)
})

test('closing while Session opening is pending releases its reference without prompting', async () => {
  let resolve, releases = 0, prompts = 0
  const ready = new Promise(done => { resolve = done })
  const sessions = { async create() { return 'assistant' }, retain() { return { ready, release() { releases++ } } } }
  const owner = createAssistantOwner({ sessions, voice: { dispose() {} }, onError() {} })
  const pending = owner.accept('hello')
  await Promise.resolve(); await Promise.resolve()
  owner.close()
  resolve({ session: { prompt() { prompts++ } } })
  await assert.rejects(pending, /ASSISTANT_CLOSED/)
  assert.equal(releases, 1); assert.equal(prompts, 0)
})

test('closing an admitted submission releases the view without cancelling native work', async () => {
  let finish, cancelled = 0, released = 0, dispatched
  const started = new Promise(resolve => { dispatched = resolve })
  const result = new Promise(resolve => { finish = resolve })
  const eventSource = { getSnapshot: () => ({ revision: 0 }), subscribe: () => () => {} }
  const session = { beginSubmission: () => ({ requestId: 'input', abandon() {} }),
    prompt() { dispatched(); return result }, cancel() { cancelled++ } }
  const sessions = { async create() { return 'assistant' }, retain() { return { ready: Promise.resolve({ session, eventSource }), release() { released++ } } } }
  const owner = createAssistantOwner({ sessions, voice: { dispose() {} }, onError() {} })
  const pending = owner.accept('run a task')
  await started
  owner.close()
  finish({ ok: true, value: { accepted: true } })
  assert.equal((await pending).value.accepted, true)
  assert.equal(cancelled, 0); assert.equal(released, 1)
})
