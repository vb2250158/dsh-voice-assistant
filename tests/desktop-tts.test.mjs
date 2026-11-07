import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopTts } from '../src/desktop-tts.mjs'

test('releases the browser audio and URL once after playback ownership ends', async () => {
  const calls = []
  const audio = { play() { calls.push('play') }, pause() { calls.push('pause') },
    removeAttribute(name) { calls.push(name) }, load() { calls.push('load') } }
  const adapter = createDesktopTts({ requestAudio: async () => 'blob', createAudio: () => audio,
    createUrl: () => 'object-url', revokeUrl: url => calls.push(url) })
  const job = await adapter.synthesize('hello')
  job.player.play(); job.player.destroy(); job.player.destroy()
  assert.deepEqual(calls, ['play', 'pause', 'src', 'load', 'object-url'])
})

test('an aborted synthesis does not create a player after its request returns', async () => {
  let resolve, created = 0
  const pending = new Promise(done => { resolve = done })
  const adapter = createDesktopTts({ requestAudio: () => pending, createAudio: () => { created++ },
    createUrl: () => { created++ }, revokeUrl() {} })
  const controller = new AbortController()
  const result = adapter.synthesize('hello', { signal: controller.signal })
  controller.abort(); resolve('blob')
  await assert.rejects(result)
  assert.equal(created, 0)
})
