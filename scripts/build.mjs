import { build } from 'esbuild'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const sdk = process.env.DSH_SHARED_ASSISTANT_ROOT
const capture = process.env.DSH_DESKTOP_CAPTURE_ENTRY
if (!sdk || !capture) throw new Error('Set DSH_SHARED_ASSISTANT_ROOT and DSH_DESKTOP_CAPTURE_ENTRY to verified local build inputs')
const manifest = JSON.parse(await readFile(join(sdk, 'package.json'), 'utf8'))
const pinned = JSON.parse(await readFile('sdk-snapshot.json', 'utf8'))
if (manifest.name !== pinned.name || manifest.version !== pinned.version) throw new Error('Unexpected assistant runtime')
const sha256 = value => createHash('sha256').update(value).digest('hex')
for (const [name, expected] of Object.entries(pinned.sourceSha256)) {
  if (sha256(await readFile(join(sdk, 'src', name))) !== expected) throw new Error(`Shared runtime mismatch: ${name}`)
}
await mkdir('dist', { recursive: true })
await build({ entryPoints: ['src/index.mjs'], outfile:'dist/index.js', bundle:true, format:'esm', platform:'node', external:['@deepseek-ai/*'] })
const entries = { '@rabilink/assistant-runtime/aiui': join(sdk,'src/aiui-runtime.js'),
  '@rabilink/assistant-runtime/voice': join(sdk,'src/voice-interaction.js'), 'dsh-speech-service/capture':resolve(capture) }
const result = await build({ entryPoints:['src/client.mjs'], bundle:true, format:'cjs', platform:'browser', target:'es2022', minifyWhitespace:true, legalComments:'none', write:false,
  external:['react','@deepseek-ai/dsh-*'], plugins:[{ name:'desktop-assistant-inputs', setup(builder) {
    builder.onResolve({ filter:/^(?:@rabilink\/assistant-runtime\/(?:aiui|voice)|dsh-speech-service\/capture)$/ }, args => ({ path:entries[args.path] }))
  } }] })
const client = `window.__ModuleLoader__.load({id:'dsh-voice-assistant',factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${result.outputFiles[0].text}\nreturn module.exports;}});\n`
await writeFile('dist/client.js', client)
await writeFile('dist/build-info.json', JSON.stringify({ sharedRuntime: pinned.version, archiveSha256:pinned.archiveSha256,
  captureSha256:sha256(await readFile(capture)) }, null, 2)+'\n')
