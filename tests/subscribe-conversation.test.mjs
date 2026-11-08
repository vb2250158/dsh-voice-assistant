import test from 'node:test'
import assert from 'node:assert/strict'
import { subscribeConversation } from '../src/subscribe-conversation.mjs'

const flush = () => new Promise(resolve => setImmediate(resolve))

test('lists an existing Session before retaining and releases the projection', async () => {
  const calls = [], received = [], errors = []
  let finishListing
  const pending = new Promise(resolve => { finishListing = resolve })
  const source = { getSnapshot: () => ({ order: [], nodes: new Map() }), subscribe() { calls.push('subscribe'); return () => calls.push('unsubscribe') } }
  const ctx = { sessions: { ensureListed(id) { calls.push('list:' + id); return pending }, retain(id) { calls.push('retain:' + id); return { ready: Promise.resolve('binding'), release() { calls.push('release') } } } }, uiConversation: { binding() { return { target: () => source } } } }
  const dispose = subscribeConversation(ctx, 'existing', value => received.push(value), error => errors.push(error))
  assert.deepEqual(calls, ['list:existing'])
  finishListing(true); await flush()
  assert.deepEqual(calls, ['list:existing', 'retain:existing', 'subscribe'])
  assert.deepEqual(received, [[]]); assert.deepEqual(errors, [])
  dispose(); assert.deepEqual(calls.slice(-2), ['unsubscribe', 'release'])
})

test('closing while listing prevents retaining or reporting late failures', async () => {
  let complete, retained = false, errors = 0
  const ctx = { sessions: { ensureListed: () => new Promise(resolve => { complete = resolve }), retain() { retained = true } } }
  const dispose = subscribeConversation(ctx, 'existing', () => {}, () => { errors++ })
  dispose(); complete(true); await flush()
  assert.equal(retained, false); assert.equal(errors, 0)
})

test('missing or synchronously failing retain reports an error without crashing', async () => {
  for (const listed of [false, true]) {
    const errors = []
    const ctx = { sessions: { ensureListed: async () => listed, retain() { throw Error('retain failed') } } }
    const dispose = subscribeConversation(ctx, 'existing', () => {}, error => errors.push(error.message))
    await flush(); assert.equal(errors.length, 1); dispose()
  }
})
