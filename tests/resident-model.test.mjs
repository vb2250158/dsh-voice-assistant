import test from 'node:test'
import assert from 'node:assert/strict'
import { createResidentHost } from './generated/resident-host.js'

test('model selection applies the provider and model to the native assistant session', async () => {
  const config = { persona: 'test persona', outputEnabled: true, asrMode: 'native', ttsProvider: 'compatible', ttsEndpoint: 'https://api.example/tts' }
  let binding = {}, selected, created
  const agent = { id: 'session', model: { current: () => selected }, ctx: {
    on: () => () => {}, systemPrompt: { assemble: async () => ({ sections: [{ name: 'voice-assistant:persona', text: config.persona }] }) },
  } }
  const ctx = { on: () => () => {}, inject: () => {}, sessionController: {
    async modelCatalog() { return { groups: [{ id: 'provider-a', name: 'Provider A', models: [{ id: 'model-x', name: 'Model X' }] }] } },
    async create(request) { created = request.sessionId; agent.id = created; return { sessionId: created } },
    async resolveAgent() { return { agent } },
    async selectModel(request) { assert.equal(request.sessionId, created); selected = { provider: request.provider, model: request.model }; return { selected } },
  } }
  const host = createResidentHost({ ctx, settings: () => config, saveSettings: async () => {}, binding: { get: () => binding, set: async value => { binding = value } },
    credentials: { describe: async () => ({ configured: false }), resolve: async () => undefined }, deviceFactory: async () => { throw Error('unexpected audio') },
  })
  const before = await host.state()
  assert.deepEqual(before.capabilities.hostModels, [{ provider: 'provider-a', model: 'model-x', label: 'Model X', providerLabel: 'Provider A' }])
  assert.equal(before.selectedModel, null)
  const after = await host.command({ action: 'select-model', provider: 'provider-a', model: 'model-x' })
  assert.deepEqual(after.selectedModel, { provider: 'provider-a', model: 'model-x' })
  await assert.rejects(host.command({ action: 'select-model', provider: '', model: 'model-x' }), /ASSISTANT_MODEL_INVALID/)
  ctx.sessionController.selectModel = async () => { throw Error('MODEL_UNAVAILABLE') }
  await assert.rejects(host.command({ action: 'select-model', provider: 'provider-b', model: 'model-y' }), /MODEL_UNAVAILABLE/)
  assert.deepEqual((await host.state()).selectedModel, { provider: 'provider-a', model: 'model-x' })
  await host.dispose()
})
