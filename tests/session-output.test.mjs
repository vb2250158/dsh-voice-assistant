import { test } from 'node:test'
import assert from 'node:assert/strict'
import { observeSessionOutput } from '../src/session-output.mjs'

test('projects only new live text once and retires its owner at durable settlement', () => {
  let snapshot = { revision: 0, change: { kind: 'replace', entries: [] } }, notify
  const source = { getSnapshot: () => snapshot, subscribe: fn => { notify = fn; return () => { notify = null } } }
  const calls = []
  const voice = { beginResponse: ({ id }) => ({ append: text => calls.push([id, text]), finish: () => calls.push([id, 'finished']) }) }
  const stop = observeSessionOutput({ eventSource: source, voice, onError: error => { throw error } })
  const delta = { type: 'transient', event: { type: 'assistant/live-chunk', data: { attemptId: 'a', chunk: { type: 'text-delta', text: 'hello' } } } }
  snapshot = { revision: 1, change: { kind: 'append', entries: [delta] } }; notify(); notify()
  snapshot = { revision: 2, change: { kind: 'settle-assistant', attemptId: 'a', entry: { event: { type: 'assistant/message', data: {} } } } }; notify()
  assert.deepEqual(calls, [['a', 'hello'], ['a', 'finished']])
  stop(); assert.equal(notify, null)
})

test('a durable successful message followed by an empty retirement is not suppressed', () => {
  let snapshot = { revision: 0 }, notify
  const source = { getSnapshot: () => snapshot, subscribe: fn => { notify = fn; return () => {} } }
  const calls = []
  const voice = { beginResponse: () => ({ append() {}, finish() { calls.push('finish') } }), interruptSpeech() { calls.push('interrupt') } }
  const stop = observeSessionOutput({ eventSource: source, voice, onError: error => { throw error } })
  snapshot = { revision: 1, change: { kind: 'append', entries: [{ type:'transient', event:{ type:'assistant/live-chunk',
    data:{ attemptId:'a', turn:2, step:3, chunk:{ type:'text-delta', text:'hello' } } } }] } }; notify()
  snapshot = { revision: 2, change: { kind:'append', entries:[{ type:'event', event:{ type:'assistant/message', data:{ turn:2, step:3 } } }] } }; notify()
  snapshot = { revision: 3, change: { kind:'settle-assistant', attemptId:'a' } }; notify()
  assert.deepEqual(calls, ['finish'])
  stop()
})

test('failed output is suppressed without interrupting a newer response', () => {
  let snapshot = { revision: 0 }, notify
  const source = { getSnapshot: () => snapshot, subscribe: fn => { notify = fn; return () => {} } }
  const calls = []
  const voice = { beginResponse: ({ id }) => ({ append() {}, finish(options) { calls.push(['finish', id, options.speak]) } }),
    interruptSpeech: reason => calls.push(['interrupt', reason]) }
  const stop = observeSessionOutput({ eventSource: source, voice, onError: error => { throw error } })
  const entry = attemptId => ({ type: 'transient', event: { type: 'assistant/live-chunk', data: { attemptId, chunk: { type: 'text-delta', text: 'text' } } } })
  snapshot = { revision: 1, change: { kind: 'append', entries: [entry('old'), entry('new')] } }; notify()
  snapshot = { revision: 2, change: { kind: 'settle-assistant', attemptId: 'old', entry: { event: { type: 'assistant/attempt', data: {} } } } }; notify()
  snapshot = { revision: 3, change: { kind: 'settle-assistant', attemptId: 'new', entry: { event: { type: 'assistant/attempt', data: {} } } } }; notify()
  assert.deepEqual(calls, [['finish', 'old', false], ['interrupt', 'assistant-output-unconfirmed'], ['finish', 'new', false]])
  stop()
})

test('late source notifications after close cannot start playback', () => {
  let snapshot = { revision: 0 }, notify, started = 0
  const source = { getSnapshot: () => snapshot, subscribe: fn => { notify = fn; return () => {} } }
  const stop = observeSessionOutput({ eventSource: source, voice: { beginResponse() { started++ } }, onError: error => { throw error } })
  stop()
  snapshot = { revision: 1, change: { kind: 'append', entries: [{ type:'transient', event:{ type:'assistant/live-chunk',
    data:{ attemptId:'late', chunk:{ type:'text-delta', text:'late' } } } }] } }
  notify()
  assert.equal(started, 0)
})
