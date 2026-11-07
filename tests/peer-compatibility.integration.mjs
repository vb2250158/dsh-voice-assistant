import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const core = process.env.VOICE_TEST_DSH_CORE, petRoot = process.env.VOICE_TEST_PET_ROOT
if (!core || !petRoot) throw Error('Set VOICE_TEST_DSH_CORE and VOICE_TEST_PET_ROOT to the candidate source roots')
const requireCore = createRequire(join(core, 'packages/boot/app-boot/package.json'))
const semver = requireCore('semver')
const read = path => JSON.parse(readFileSync(path, 'utf8'))

test('assistant and pet peers accept the actual Core prereleases without global prerelease overrides', () => {
  const assistant = read(new URL('../package.json', import.meta.url))
  const pet = read(join(petRoot, 'package.json')), nestedPet = read(join(petRoot, 'dsh-pet/package.json'))
  const versions = new Map()
  for (const group of readdirSync(join(core, 'packages'), { withFileTypes: true }).filter(row => row.isDirectory())) {
    for (const folder of readdirSync(join(core, 'packages', group.name), { withFileTypes: true }).filter(row => row.isDirectory())) {
      const path = join(core, 'packages', group.name, folder.name, 'package.json')
      if (!existsSync(path)) continue
      const pkg = read(path); versions.set(pkg.name, pkg.version)
    }
  }
  for (const name of ['cordis', 'schemastery']) {
    const pkg = read(join(core, 'vendor', name, 'package.json')); versions.set(pkg.name, pkg.version)
  }
  assert.equal(semver.satisfies('0.2.2-rc.1', '>=0.2.1-alpha.1 <0.3.0'), false, 'old range is a negative control')
  let checked = 0, common = 0
  for (const pkg of [assistant, pet, nestedPet]) for (const [name, range] of Object.entries(pkg.peerDependencies)) {
    if (!name.startsWith('@deepseek-ai/')) continue
    assert.ok(versions.has(name), name + ' must come from the selected Core')
    assert.ok(semver.satisfies(versions.get(name), range), pkg.name + ': ' + name + ' rejects actual Core ' + versions.get(name) + ' with ' + range)
    checked++
  }
  for (const [name, range] of Object.entries(pet.peerDependencies)) {
    assert.equal(nestedPet.peerDependencies[name], range, 'root/nested peer declarations must agree')
    if (!name.startsWith('@deepseek-ai/') || !assistant.peerDependencies[name]) continue
    assert.ok(semver.intersects(range, assistant.peerDependencies[name]), name + ' has no common admissible host')
    common++
  }
  assert.ok(checked >= 30); assert.ok(common >= 5)
})
