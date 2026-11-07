import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Explicit isolated profile: never silently substitute mocks or read the user's DSH Home.
const profile = process.env.VOICE_TEST_DSH_PROFILE
if (!profile) throw Error('Set VOICE_TEST_DSH_PROFILE to an independently installed DSH profile')
const requireProfile = createRequire(pathToFileURL(join(profile, 'package.json')))
const requireHost = createRequire(requireProfile.resolve('dsh-voice-assistant/package.json'))
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@deepseek-ai/') || specifier === 'koffi')
    return { url: pathToFileURL(requireHost.resolve(specifier)).href, shortCircuit: true }
  return next(specifier, context)
} })

test('built Host imports with real DSH peers and its real storage domain persists and reopens', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { default: Storage } = await import('@deepseek-ai/dsh-storage')
  const { DomainFacility, defineDomain } = await import('@deepseek-ai/dsh-storage-domain')
  // Guard the original failure with the actual official validator.
  assert.throws(() => defineDomain({ name: 'voice-assistant', version: 1, tables: {} }), /must match/)
  const plugin = await import('../dist/index.js')
  assert.equal(plugin.domainSpec.name, 'voice_assistant')
  assert.equal(typeof plugin.apply, 'function')
  const ctx = new Context()
  let global = null
  const records = new Map()
  const copy = value => structuredClone(value)
  try {
    await ctx.plugin(Storage)
    ctx.storage.backend.register('test', { kv: { async open() { return {
      async loadAll() { return { global: copy(global), tables: { requests: Object.fromEntries(records) } } },
      async setGlobal(value) { global = copy(value) },
      async putRecord(_table, key, value) { records.set(key, copy(value)) },
      async deleteRecord(_table, key) { records.delete(key) },
      async deleteRecords(_table, keys) { for (const key of keys) records.delete(key) },
      async close() {},
    } } }, async close() {} })
    const facility = new DomainFacility(ctx, { backend: 'test', routes: {} })
    const first = await facility.open(plugin.domainSpec)
    await first.global.set({ sessionId: 'fixture-session', creating: false })
    await first.table('requests').put('fixture-request', { fingerprint: 'fixture', sessionId: 'fixture-session', requestId: 'fixture-request', status: 'accepted', result: { accepted: true } })
    await first.close()
    const second = await facility.open(plugin.domainSpec)
    assert.equal(second.global.get().sessionId, 'fixture-session')
    assert.equal(second.table('requests').get('fixture-request').status, 'accepted')
    await second.close()
  } finally { await ctx.fiber.dispose(); hook.deregister() }
})
