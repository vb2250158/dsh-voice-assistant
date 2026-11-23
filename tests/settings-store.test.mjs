import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsStore } from './generated/settings-store.js'

function fixture(initial = Object.freeze({ speechProfiles: Object.freeze({}) })) {
  let config = initial, revision = 3, writes = 0
  const service = {
    describe: () => [{ ns: 'voice', value: config, user: config, revision }],
    async replace(namespace, next, expected) {
      assert.equal(namespace, 'voice'); assert.equal(expected, revision)
      config = next; revision++; writes++
    },
    async update(namespace, next, expected) {
      assert.equal(namespace, 'voice'); assert.equal(expected, revision)
      config = next; revision++; writes++
    },
  }
  return { store: createSettingsStore(service, 'voice', () => config), config: () => config, writes: () => writes }
}

test('shared OpenAI settings and dynamic expression survive model changes', async () => {
  const f = fixture()
  await f.store.saveBatch([{ ttsModel:'gpt-4o-mini-tts', ttsVoice:'alloy', ttsSpeed:1.2, ttsDynamicExpression:true },
    { ttsModel:'tts-1', ttsVoice:'nova', ttsSpeed:.8 }, { ttsModel:'gpt-4o-mini-tts' }])
  const value = f.store.read()
  assert.equal(value.ttsVoice, 'alloy')
  assert.equal(value.ttsSpeed, 1.2)
  assert.equal(value.ttsDynamicExpression, true)
  await f.store.save({ asrLanguage:'zh', asrPrompt:'专有名词', asrTemperature:.2, asrWordTimestamps:true })
  assert.equal(f.store.read().asrLanguage,'zh')
  await f.store.close()
})

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

test('shared assistant settings persist and reject invalid favorites', async () => {
  const f = fixture()
  const patch = { onboardingComplete: true, assistantName: '小助手', voiceFavorites: JSON.stringify(['volcengine:seed-tts-2.0:voice-a']) }
  await f.store.save(patch)
  assert.equal(f.store.read().onboardingComplete, true)
  assert.equal(f.store.read().assistantName, '小助手')
  assert.deepEqual(JSON.parse(f.store.read().voiceFavorites), ['volcengine:seed-tts-2.0:voice-a'])
  for (const voiceFavorites of ['bad-json', '{}', JSON.stringify([1])]) {
    await assert.rejects(f.store.save({ voiceFavorites }), /ASSISTANT_SETTINGS_INVALID/)
  }
  assert.equal(f.writes(), 1)
  await f.store.close()
})

test('continuous recognition defaults to end-of-speech detection and allows enabling older profiles', async () => {
  const f = fixture()
  assert.equal(f.store.read().asrEndWindowEnabled, true)
  assert.equal(f.store.read().asrEndWindowSize, 800)
  await f.store.saveBatch([{ asrMode: 'volcengine' }, { asrEndWindowEnabled: false }])
  assert.equal(f.store.read().asrEndWindowEnabled, false)
  await f.store.save({ asrEndWindowEnabled: true })
  assert.equal(f.store.read().asrEndWindowEnabled, true)
  await f.store.close()
})

test('new installs keep the shared caption default and preserve an explicit choice', async () => {
  const f = fixture()
  assert.equal(f.store.read().captionsEnabled, false)
  await f.store.save({ captionsEnabled: true })
  assert.equal(f.store.read().captionsEnabled, true)
  await f.store.close()
})

test('legacy hotwords become one dictionary and remain independent of provider selection', async () => {
  const legacy = { asrHotwords: '夜雨\n秋雨', speechProfiles: { asr: { volcengine: { asrHotwords: '秋雨\n拉比' } } } }
  const f = fixture(legacy)
  assert.equal(f.store.read().asrDictionary, '夜雨\n秋雨\n拉比')
  assert.deepEqual(f.config(), legacy)
  await f.store.saveBatch([{ asrMode: 'volcengine' }, { asrMode: 'compatible' }, { asrMode: 'native' }])
  assert.equal(f.writes(), 1)
  assert.equal(f.store.read().asrDictionary, '夜雨\n秋雨\n拉比')
  assert.equal(Object.hasOwn(f.config(), 'asrHotwords'), false)
  assert.ok(!JSON.stringify(f.config().speechProfiles).includes('asrHotwords'))
  await f.store.save({ asrDictionary: '' })
  assert.equal(f.store.read().asrDictionary, '')
  await f.store.close()
})
