import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SettingsSchema } from '../src/settings.mjs'

test('settings data cannot become a schema callback', () => {
  const marker = '__dshSettingsCallbackExecuted'
  const callback = `() => { globalThis.${marker} = true }`
  delete globalThis[marker]
  const settings = SettingsSchema({ agentPreset: callback, callback, refs: { callback } })
  assert.equal(settings.agentPreset, callback)
  assert.equal(globalThis[marker], undefined)
  assert.throws(() => SettingsSchema({ agentPreset: { callback }, callback }))
  assert.equal(globalThis[marker], undefined)
})
