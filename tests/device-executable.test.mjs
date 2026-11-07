import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { resolveElectronExecutable } from '../src/device-executable.mjs'

test('Electron discovery stays in selected Home and only an explicit path crosses installations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voice-executable-test-'))
  try {
    await assert.rejects(resolveElectronExecutable('', root), /^Error: DEVICE_ELECTRON_NOT_FOUND$/)
    assert.equal(await resolveElectronExecutable(process.execPath, root), process.execPath)
    await assert.rejects(resolveElectronExecutable('electron.exe', root), /DEVICE_ELECTRON_PATH_INVALID/)
    await assert.rejects(resolveElectronExecutable(root, root), /DEVICE_ELECTRON_PATH_INVALID/)
    await mkdir(join(root, 'electron'))
    const executable = join(root, 'electron', 'electron.exe')
    await writeFile(executable, '')
    await assert.rejects(resolveElectronExecutable('', root), /DEVICE_ELECTRON_PATH_INVALID/)
    await writeFile(executable, 'fixture; never executed')
    assert.equal(await resolveElectronExecutable('', root), executable)
    // A missing explicit path must not silently fall back to the default installation.
    await assert.rejects(resolveElectronExecutable(join(root, 'missing.exe'), root), /DEVICE_ELECTRON_NOT_FOUND/)
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'voice-executable-test-'))
    await rm(root, { recursive: true, force: true })
  }
})
