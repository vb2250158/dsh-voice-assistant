import test from 'node:test'
import assert from 'node:assert/strict'
import {createResidentHost} from './generated/resident-host.js'
import {createSettingsStore} from './generated/settings-store.js'
import {createSpeechCredentials} from '../src/speech-credentials.mjs'
function fixture(initial={}) {
  let value={electronExecutable:process.execPath,...initial},revision=0,opens=0,failCleanup=false
  const store=createSettingsStore({describe:()=>[{ns:'voice',value,revision}],async update(_ns,patch,expected){assert.equal(expected,revision);value={...value,...patch};revision++}},'voice',()=>value)
  const credentials=createSpeechCredentials({describeRecord:async()=>({configured:false,writable:true})},(a,b)=>a+'/'+b)
  const host=createResidentHost({ctx:{on:()=>()=>{}},settings:store.read,saveSettings:store.save,binding:{get:()=>({})},credentials,
    deviceFactory:async()=>{opens++;return {enumerateDevices:async()=>[],async close(){if(failCleanup)throw Error('PROCESS_CLEANUP_UNCONFIRMED')}}}})
  return {host,store,opens:()=>opens,failCleanup:()=>{failCleanup=true}}
}
test('failed diagnostic release fences subsequent diagnostics and resident acquisition',async()=>{
  const f=fixture();f.failCleanup()
  await assert.rejects(f.host.command({action:'devices'}),/CLEANUP_UNCONFIRMED/)
  await assert.rejects(f.host.command({action:'devices'}),/CLEANUP_UNCONFIRMED/)
  await assert.rejects(f.host.command({action:'start'}),/CLEANUP_UNCONFIRMED/)
  assert.equal(f.opens(),1);await assert.rejects(f.host.dispose(),/CLEANUP_UNCONFIRMED/)
})
test('invalid endpoint save is rejected before persistence and status stays readable',async()=>{
  const f=fixture(),before=await f.host.state()
  for(const endpoint of ['broken','http://external.example/tts','https://tts.example/?key=value']){
    await assert.rejects(f.host.command({action:'settings',patch:{ttsEndpoint:endpoint}}),/SPEECH_ENDPOINT/)
    assert.equal((await f.host.state()).settings.ttsEndpoint,before.settings.ttsEndpoint)
  }
  await f.host.dispose()
})
test('historical invalid endpoint remains editable through the same accessor used by entry',async()=>{
  const f=fixture({ttsEndpoint:'broken'}),before=await f.host.state()
  assert.equal(before.settings.ttsEndpoint,'broken');assert.equal(before.credentials.tts.error,'SPEECH_ENDPOINT_INVALID')
  await f.host.command({action:'settings',patch:{ttsEndpoint:'https://tts.example/v1/audio/speech'}})
  assert.equal((await f.host.state()).credentials.tts.writable,true)
  await f.host.dispose()
})
