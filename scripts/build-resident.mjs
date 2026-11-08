import {createRequire} from 'node:module'
import {readFile,writeFile,mkdir,cp,readdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
const require=createRequire(import.meta.url)
const {build}=require(process.env.VOICE_ESBUILD_PATH||'esbuild')
const sdk=process.env.DSH_SHARED_ASSISTANT_ROOT,pc=process.env.DSH_DESKTOP_SERVICE_ROOT
if(!sdk||!pc)throw Error('Set DSH_SHARED_ASSISTANT_ROOT and DSH_DESKTOP_SERVICE_ROOT to verified build inputs')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
async function snapshot(root,folders){
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8')),files={}
  async function walk(relative){for(const item of await readdir(join(root,relative),{withFileTypes:true})){const name=relative+'/'+item.name;if(item.isDirectory())await walk(name);else files[name]=sha(await readFile(join(root,name)))}}
  for(const folder of folders)await walk(folder)
  return {name:pkg.name,version:pkg.version,files}
}
const inputs={sdk:await snapshot(sdk,['src','ui']),desktop:await snapshot(pc,['src','runtime'])}
if(inputs.sdk.name!=='@rabilink/assistant-runtime'||inputs.sdk.version!=='0.13.0'||inputs.desktop.name!=='@rabilink/desktop-voice-service'||inputs.desktop.version!=='0.3.0')throw Error('Unexpected shared input')
const entries={
  '@rabilink/assistant-runtime/resident':join(sdk,'src/resident-interaction.js'),
  '@rabilink/assistant-runtime/aiui':join(sdk,'src/aiui-runtime.js'),
  '@rabilink/assistant-runtime/ui':join(sdk,'ui/assistant-panel.js'),
  '@rabilink/desktop-voice-service/node':join(pc,'src/node-device.mjs'),
  '@rabilink/desktop-voice-service/services':join(pc,'src/services.mjs'),
  '@rabilink/desktop-voice-service/providers':join(pc,'src/providers.mjs'),
  '@rabilink/desktop-voice-service/host':join(pc,'src/assistant-host.mjs'),
  '@rabilink/desktop-voice-service/speech-providers':join(pc,'src/speech-providers.mjs'),
  '@rabilink/desktop-voice-service/provider-profiles':join(pc,'src/provider-profiles.mjs'),
  '@rabilink/desktop-voice-service/speech-catalog':join(pc,'src/speech-catalog.mjs'),
  '@rabilink/assistant-runtime/playback':join(sdk,'src/speech-playback.js'),
}
const shared={name:'shared-voice-inputs',setup(builder){builder.onResolve({filter:/^@rabilink\//},args=>{if(!entries[args.path])throw Error('Unknown shared import');return {path:resolve(entries[args.path])}})}}
const nodePaths=(process.env.VOICE_BUILD_NODE_PATHS||'').split(';').filter(Boolean)
await mkdir('dist',{recursive:true})
await build({entryPoints:['src/resident-entry.mjs'],outfile:'dist/index.js',bundle:true,format:'esm',platform:'node',target:'node24',external:['@deepseek-ai/*','koffi','ws'],plugins:[shared],nodePaths,minifyWhitespace:true,legalComments:'none'})
const client=await build({entryPoints:['src/resident-client.mjs'],bundle:true,format:'cjs',platform:'browser',target:'es2022',write:false,
  external:['react','@deepseek-ai/dsh-*'],plugins:[shared],nodePaths,minifyWhitespace:true,legalComments:'none'})
await writeFile('dist/client.js',`window.__ModuleLoader__.load({id:'dsh-voice-assistant',factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`)
await cp(join(pc,'runtime'),'runtime',{recursive:true})
await writeFile('dist/build-info.json',JSON.stringify({schemaVersion:2,inputs,hostSha256:sha(await readFile('dist/index.js')),clientSha256:sha(await readFile('dist/client.js'))},null,2)+'\n')
await writeFile('sdk-snapshot.json',JSON.stringify(inputs,null,2)+'\n')
await mkdir('tests/generated',{recursive:true})
await build({entryPoints:['src/resident-host.mjs','src/settings-store.mjs','src/speech-credentials.mjs',join(pc,'src/device-executable.mjs')],outdir:'tests/generated',bundle:true,format:'esm',platform:'node',target:'node24',banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"},plugins:[shared],nodePaths})
console.log('Built resident Host, optional shared UI, and owned desktop runtime')
