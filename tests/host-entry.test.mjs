import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SettingsSchema, apply, inject, name } from '../dist/index.js'

test('built Host entry exposes validated desktop voice settings', () => {
  assert.equal(name, 'dsh-voice-assistant')
  assert.deepEqual(inject, ['settings'])
  const settings = SettingsSchema({})
  assert.equal(settings.agentPreset, '')
  assert.ok(settings.silenceDurationMs > 0)
  assert.throws(() => SettingsSchema({ silenceThreshold: 2 }))
  let configured = false
  const ctx = { fiber: {}, effect(fn) { fn() }, settings: { configure(value) { configured = value.auto === false } } }
  apply(ctx)
  assert.equal(configured, true)
})
