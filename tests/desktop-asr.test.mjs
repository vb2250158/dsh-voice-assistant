import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopAsr } from '../src/desktop-asr.mjs'

test('desktop voice produces speech end before final transcription and releases capture', async () => {
  let tick, time = 0, amplitude = 0, disposed = 0, transcriptions = 0
  const events = []
  const clock = { now: () => time, setTimeout: () => 1, clearTimeout() {}, setInterval: fn => { tick = fn; return 2 }, clearInterval() {} }
  const adapter = createDesktopAsr({ clock, settings: () => ({ threshold: .1, silenceMs: 100, maxDurationMs: 1000, sampleMs: 10 }),
    createRecording: () => ({ async start() {}, amplitude: () => amplitude, async stop() { return 'audio' }, async dispose() { disposed++ } }),
    async transcribe(audio) { assert.equal(audio, 'audio'); transcriptions++; return { text: 'hello' } } })
  const round = adapter.createRound({ onStart: () => events.push('start'), onSpeechStart: () => events.push('speech'),
    onSpeechEnd: () => events.push('speech-end'), onFinal: value => events.push(value.text), onEnd: () => events.push('end') })
  await adapter.start(round)
  amplitude = .5; tick(); amplitude = 0; tick(); time = 101; tick()
  for (let i = 0; i < 10 && disposed === 0; i++) await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(events, ['start', 'speech', 'speech-end', 'hello', 'end'])
  assert.equal(transcriptions, 1); assert.equal(disposed, 1)
})

test('stopping during microphone permission prevents transcription and late events', async () => {
  let grant, disposed = 0, transcriptions = 0
  const events = []
  const pending = new Promise(resolve => { grant = resolve })
  const clock = { now: () => 0, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {} }
  const adapter = createDesktopAsr({ clock, settings: () => ({ threshold: .1, silenceMs: 100, maxDurationMs: 1000, sampleMs: 10 }),
    createRecording: () => ({ start: () => pending, dispose() { disposed++ } }), transcribe() { transcriptions++ } })
  const round = adapter.createRound({ onStart: () => events.push('start') })
  const starting = adapter.start(round); adapter.stop(round); grant(); await starting
  assert.equal(disposed, 1); assert.equal(transcriptions, 0); assert.deepEqual(events, [])
})

test('synchronous stop on start does not schedule recording timers', async () => {
  let timers = 0, disposed = 0
  const clock = { now: () => 0, setTimeout() { timers++ }, clearTimeout() {}, setInterval() { timers++ }, clearInterval() {} }
  const adapter = createDesktopAsr({ clock, settings: () => ({ threshold: .1, silenceMs: 100, maxDurationMs: 1000, sampleMs: 10 }),
    createRecording: () => ({ async start() {}, dispose() { disposed++ } }), transcribe() {} })
  const round = adapter.createRound({ onStart: () => adapter.stop(round) })
  await adapter.start(round)
  assert.equal(timers, 0); assert.equal(disposed, 1)
})
