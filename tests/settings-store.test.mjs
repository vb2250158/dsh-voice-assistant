import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsStore } from './generated/settings-store.js'

function fixture() {
  let config = Object.freeze({ speechProfiles: Object.freeze({}) }), revision = 3, writes = 0
  const service = {
    describe: () => [{ ns: 'voice', value: config, revision }],
    async update(namespace, next, expected) {
      assert.equal(namespace, 'voice'); assert.equal(expected, revision)
      config = next; revision++; writes++
    },
  }
  return { store: createSettingsStore(service, 'voice', () => config), config: () => config, writes: () => writes }
}

test('preview applies provider patches without mutating or writing stored settings', async () => {
  const f = fixture(), original = f.config(), snapshot = structuredClone(original)
  const patches = [{ asrMode: 'volcengine' }, { asrModel: 'bigmodel-1.0', asrEnableEmotionDetection: true }]
  const draft = f.store.preview(patches)
  assert.equal(draft.asrMode, 'volcengine')
  assert.equal(draft.asrModel, 'bigmodel-1.0')
  assert.equal(draft.asrResourceId, 'volc.bigasr.sauc.duration')
  assert.equal(draft.asrEnableEmotionDetection, true)
  assert.equal(f.writes(), 0)
  assert.equal(f.store.preview([]).asrMode, 'native')
  await f.store.saveBatch([])
  assert.equal(f.writes(), 0)
  assert.equal(f.config(), original)
  assert.deepEqual(original, snapshot)
  assert.equal(f.store.read().asrMode, 'native')
  await f.store.close()
})

test('batch persists all patches in one update and later batches see the latest revision', async () => {
  const f = fixture()
  await f.store.saveBatch([{ asrMode: 'volcengine' }, { asrModel: 'bigmodel-1.0', asrEnableEmotionDetection: true }])
  assert.equal(f.writes(), 1)
  assert.equal(f.store.read().asrResourceId, 'volc.bigasr.sauc.duration')
  assert.equal(f.store.read().asrEnableEmotionDetection, true)
  await Promise.all([f.store.save({ outputEnabled: false }), f.store.save({ captionsEnabled: false })])
  assert.equal(f.writes(), 3)
  assert.equal(f.store.read().outputEnabled, false)
  assert.equal(f.store.read().captionsEnabled, false)
  await f.store.close()
})

test('malformed, oversized and direct profile patches never write', async () => {
  const f = fixture()
  for (const patches of [null, {}, Array(65).fill({ outputEnabled: true }), [null], [[]], [{ speechProfiles: {} }], [{ unexpected: true }], [{ asrEndWindowSize: 200 }]]) {
    assert.throws(() => f.store.preview(patches), /ASSISTANT_SETTINGS_INVALID/)
    await assert.rejects(f.store.saveBatch(patches), /ASSISTANT_SETTINGS_INVALID/)
  }
  assert.equal(f.writes(), 0)
  await f.store.close()
  assert.throws(() => f.store.preview([{ outputEnabled: true }]), /ASSISTANT_CLOSED/)
})

test('draft provider changes keep per-model values until one explicit save', async () => {
  const f = fixture()
  const patches = [
    { ttsProvider: 'volcengine' },
    { ttsVoice: 'voice-a', ttsSampleRate: 16000 },
    { ttsModel: 'seed-tts-1.0' },
    { ttsVoice: 'voice-b', ttsSampleRate: 48000 },
    { ttsModel: 'seed-tts-2.0' },
  ]
  const draft = f.store.preview(patches)
  assert.equal(draft.ttsVoice, 'voice-a')
  assert.equal(draft.ttsSampleRate, 16000)
  assert.equal(f.store.read().ttsProvider, 'compatible')
  assert.equal(f.writes(), 0)
  await f.store.saveBatch(patches)
  assert.equal(f.writes(), 1)
  assert.equal(f.store.read().ttsVoice, 'voice-a')
  assert.equal(f.store.read().ttsSampleRate, 16000)
  await f.store.close()
})
