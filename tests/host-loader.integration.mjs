import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readdirSync, existsSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const profile = process.env.VOICE_TEST_DSH_PROFILE
if (!profile) throw Error('Set VOICE_TEST_DSH_PROFILE to an independently installed DSH profile')
const requireProfile = createRequire(pathToFileURL(join(profile, 'package.json')))
const requireHost = createRequire(requireProfile.resolve('dsh-voice-assistant/package.json'))
const core = process.env.VOICE_TEST_DSH_CORE
if (!core) throw Error('Set VOICE_TEST_DSH_CORE to the matching independently built Core source')
const requireBoot = createRequire(pathToFileURL(join(core, 'packages/boot/app-boot/package.json')))
const coreModules = new Map()
// Discover only the declared package roots of this explicitly selected Core.
for (const group of fsReaddir(join(core, 'packages'))) {
  for (const folder of fsReaddir(join(core, 'packages', group))) {
    const manifest = join(core, 'packages', group, folder, 'package.json')
    if (!existsSync(manifest)) continue
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    if (pkg.name && pkg.main) coreModules.set(pkg.name, join(core, 'packages', group, folder, pkg.main))
  }
}
function fsReaddir(path) { return readdirSync(path, { withFileTypes: true }).filter(row => row.isDirectory()).map(row => row.name) }
const hook = registerHooks({ resolve(specifier, context, next) {
  if (coreModules.has(specifier)) return { url: pathToFileURL(coreModules.get(specifier)).href, shortCircuit: true }
  if (specifier === '@deepseek-ai/cordis' || specifier === '@deepseek-ai/cordis-plugin-loader' || specifier === '@deepseek-ai/schemastery')
    return { url: pathToFileURL(requireBoot.resolve(specifier)).href, shortCircuit: true }
  try { return next(specifier, context) } catch (error) {
    if (!specifier.startsWith('@deepseek-ai/') && specifier !== 'koffi') throw error
    return { url: pathToFileURL(requireHost.resolve(specifier)).href, shortCircuit: true }
  }
} })

test('real Loader activates complete built apply, preserves live Config and persists settings under its entry id', { timeout: 20000 }, async () => {
  const { boot, initProfile, readProfilePatches } = await import('@deepseek-ai/dsh-app-boot')
  const { default: ConfigEditor } = await import('@deepseek-ai/dsh-config-editor')
  const { default: Settings } = await import('@deepseek-ai/dsh-settings')
  const { default: Storage } = await import('@deepseek-ai/dsh-storage')
  const { DomainFacility } = await import('@deepseek-ai/dsh-storage-domain')

  const plugin = await import('../dist/index.js')
  const parent = realpathSync(tmpdir())
  const home = realpathSync(mkdtempSync(join(parent, 'voice-loader-contract-')))
  const dir = join(home, 'profiles', 'test'), namespace = 'spoken-assistant'
  const routes = new Map(), media = new Map()
  let ctx, activeAtApply, routeRemovals = 0, rejectRoute = false
  try {
    initProfile(dir, ['test-bundle'])
    const bundle = join(dir, 'node_modules', 'test-bundle')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(home, 'package.json'), '{"name":"voice-loader-contract"}\n')
    writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      { id: 'config-editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
      { id: 'storage', name: 'cordis:storage' }, { id: 'ports', name: 'cordis:ports' },
      { id: namespace, name: 'cordis:assistant', config: { persona: 'persisted fixture persona', captionFontSize: 29 } },
    ] }]))
    writeFileSync(join(dir, 'cordis.yml'), '[]\n')
    const context = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
    const Ports = { inject: ['storage'], apply(owner) {
      // Only transport/credentials/model ports and the storage medium are fixtures; Loader,
      // Settings, ConfigEditor, DomainFacility and the entire built assistant apply are real.
      owner.storage.backend.register('test', { kv: { async open(spec) {
        const record = media.get(spec.name) ?? { global: null, tables: {} }; media.set(spec.name, record)
        return { async loadAll() { return structuredClone(record) }, async setGlobal(value) { record.global = structuredClone(value) },
          async putRecord(table, key, value) { (record.tables[table] ??= {})[key] = structuredClone(value) },
          async deleteRecord(table, key) { delete record.tables[table]?.[key] }, async close() {} }
      } }, async close() {} })
      owner.provide('storageDomain', new DomainFacility(owner, { backend: 'test', routes: {} }))
      owner.provide('credentials', { async describeRecord() { return { configured: false, writable: true } } })
      owner.provide('connection', { fetch: { register(route) { if (rejectRoute) throw Error('FIXTURE_ROUTE_REJECTED'); routes.set(route.path, route); return () => { routes.delete(route.path); routeRemovals++ } } } })
      owner.provide('sessionController', { create() { assert.fail('loading settings must not create a model session') } })
    } }
    const Assistant = { ...plugin, async apply(owner, config) {
      activeAtApply = owner.settings.describe().some(row => row.ns === namespace)
      await plugin.apply(owner, config)
    } }
    ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', context), root => {
      ctx = root
      root.provide('profileContext', context)
      root.provide('appReady', { onReady(listener) { listener(); return () => {} } })
      Object.assign(root.loader.builtins, { editor: ConfigEditor, settings: Settings, storage: Storage, ports: Ports, assistant: Assistant })
    })
    await ctx.loader.await()
    const entry = ctx.configEditor.entries().find(value => value.options.id === namespace)
    assert.ok(entry?.fiber, 'assistant Loader entry must exist')
    assert.ok(ctx.settings.describe().some(row => row.ns === namespace), 'complete apply must activate')
    assert.equal(activeAtApply, false, 'regression exercises pre-ACTIVE apply')
    const request = async body => {
      const route = routes.get('/api/voice-assistant'); assert.ok(route, 'Host route must be registered')
      const response = await route.fetch(new Request('http://localhost/api/voice-assistant', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}))
      assert.equal(response.status, 200); return response.json()
    }
    const first = await request()
    assert.equal(first.settings.persona, 'persisted fixture persona')
    assert.equal(first.settings.captionFontSize, 29)
    assert.equal(ctx.settings.describe().find(row => row.ns === namespace).autoGenerate, false)
    await request({ action: 'settings', patch: { persona: 'updated fixture persona', captionFontSize: 31 } })
    assert.equal((await request()).settings.persona, 'updated fixture persona')
    assert.ok(readFileSync(context.patchPath, 'utf8').includes('updated fixture persona'))
    assert.ok(ctx.settings.describe().some(row => row.ns === namespace))
    await entry.update({ disabled: true }); await ctx.loader.await()
    assert.equal(routes.size, 0); assert.equal(routeRemovals, 1)
    await entry.update({ disabled: false }); await ctx.loader.await()
    assert.ok(ctx.settings.describe().some(row => row.ns === namespace))
    assert.equal((await request()).settings.captionFontSize, 31)
    // A carrier failure after domain acquisition must release the domain for the next activation.
    await entry.update({ disabled: true }); await ctx.loader.await()
    rejectRoute = true
    await entry.update({ disabled: false }); await ctx.loader.await()
    assert.equal(routes.size, 0)
    assert.equal(ctx.settings.describe().some(row => row.ns === namespace), false)
    await entry.update({ disabled: true }); await ctx.loader.await()
    rejectRoute = false
    await entry.update({ disabled: false }); await ctx.loader.await()
    assert.equal((await request()).settings.captionFontSize, 31)
  } finally {
    await ctx?.fiber.dispose()
    hook.deregister()
    // Remove only the fixture created above, after checking its resolved parent and prefix.
    assert.ok(resolve(home).startsWith(resolve(parent) + sep + 'voice-loader-contract-'))
    rmSync(home, { recursive: true, force: true })
  }
})
