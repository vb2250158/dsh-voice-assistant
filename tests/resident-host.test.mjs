import test from 'node:test'
import assert from 'node:assert/strict'
import {createResidentHost} from './generated/resident-host.js'
import {createSettingsStore} from './generated/settings-store.js'
import {createSpeechCredentials} from './generated/speech-credentials.js'
function fixture(initial={}) {
  let value={electronExecutable:process.execPath,...initial},revision=0,opens=0,failCleanup=false
  const store=createSettingsStore({describe:()=>[{ns:'voice',value,revision}],async update(_ns,patch,expected){assert.equal(expected,revision);value={...value,...patch};revision++}},'voice',()=>value)
  const credentials=createSpeechCredentials({describeRecord:async()=>({configured:false,writable:true})},(a,b)=>a+'/'+b)
  const host=createResidentHost({ctx:{on:()=>()=>{},inject:()=>{},sessionController:{modelCatalog:async()=>({groups:[]})}},settings:store.read,saveSettings:store.save,binding:{get:()=>({})},credentials,
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

test('switching speech providers restores each provider settings independently',async()=>{
  const f=fixture()
  await f.host.command({action:'settings',patch:{asrMode:'compatible',asrEndpoint:'https://asr.example/v1/audio/transcriptions',asrModel:'whisper'}})
  await f.host.command({action:'settings',patch:{asrMode:'volcengine'}})
  let state=await f.host.state()
  assert.equal(state.settings.asrEndpoint,'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async')
  await f.host.command({action:'settings',patch:{asrMode:'compatible'}})
  state=await f.host.state()
  assert.equal(state.settings.asrEndpoint,'https://asr.example/v1/audio/transcriptions')
  assert.equal(state.settings.asrModel,'whisper')
  await f.host.command({action:'settings',patch:{ttsProvider:'volcengine'}})
  state=await f.host.state()
  assert.equal(state.settings.ttsEndpoint,'wss://openspeech.bytedance.com/api/v3/tts/bidirection')
  await f.host.command({action:'settings',patch:{ttsProvider:'compatible'}})
  state=await f.host.state()
  assert.equal(state.settings.ttsEndpoint,'https://api.openai.com/v1/audio/speech')
  await f.host.dispose()
})

test('Volcengine speech options survive provider switches with their original types',async()=>{
  const f=fixture()
  await f.host.command({action:'settings',patch:{asrMode:'volcengine'}})
  await f.host.command({action:'settings',patch:{asrEnableEmotionDetection:true,asrResultType:'single',asrEndWindowSize:900,asrRecognitionMode:'twopass'}})
  await f.host.command({action:'settings',patch:{asrMode:'compatible'}})
  await f.host.command({action:'settings',patch:{asrMode:'volcengine'}})
  let state=await f.host.state()
  assert.equal(state.settings.asrEnableEmotionDetection,true)
  assert.equal(state.settings.asrResultType,'single')
  assert.equal(state.settings.asrEndWindowSize,900)
  assert.equal(state.settings.asrRecognitionMode,'twopass')
  await f.host.command({action:'settings',patch:{ttsProvider:'volcengine'}})
  await f.host.command({action:'settings',patch:{ttsEmotion:'happy',ttsEmotionScale:5,ttsSpeechRate:20}})
  await f.host.command({action:'settings',patch:{ttsProvider:'compatible'}})
  await f.host.command({action:'settings',patch:{ttsProvider:'volcengine'}})
  state=await f.host.state()
  assert.equal(state.settings.ttsEmotion,'happy')
  assert.equal(state.settings.ttsEmotionScale,5)
  assert.equal(state.settings.ttsSpeechRate,20)
  await assert.rejects(f.host.command({action:'settings',patch:{asrEndWindowSize:200}}),/ASSISTANT_SETTINGS_INVALID/)
  await assert.rejects(f.host.command({action:'settings',patch:{asrResultType:'unknown'}}),/ASSISTANT_SETTINGS_INVALID/)
  await f.host.dispose()
})

test('numeric speech options and voices stay with their Volcengine model',async()=>{
  const f=fixture()
  await f.host.command({action:'settings',patch:{ttsProvider:'volcengine'}})
  await f.host.command({action:'settings',patch:{ttsSampleRate:16000,ttsParenthesisFilter:0,ttsVoice:'voice-2'}})
  await f.host.command({action:'settings',patch:{ttsModel:'seed-tts-1.0'}})
  let state=await f.host.state()
  assert.equal(state.settings.ttsSampleRate,24000)
  assert.equal(state.settings.ttsVoice,'')
  assert.equal(state.settings.ttsResourceId,'seed-tts-1.0')
  await f.host.command({action:'settings',patch:{ttsSampleRate:48000,ttsParenthesisFilter:100,ttsVoice:'voice-1'}})
  await f.host.command({action:'settings',patch:{ttsModel:'seed-tts-2.0'}})
  state=await f.host.state()
  assert.equal(state.settings.ttsSampleRate,16000)
  assert.equal(state.settings.ttsParenthesisFilter,0)
  assert.equal(state.settings.ttsVoice,'voice-2')
  assert.equal(state.settings.ttsResourceId,'seed-tts-2.0')
  await assert.rejects(f.host.command({action:'settings',patch:{ttsSampleRate:12345}}),/ASSISTANT_SETTINGS_INVALID/)
  await f.host.dispose()
})

test('ASR model selection restores model parameters and changes the resource',async()=>{
  const f=fixture()
  await f.host.command({action:'settings',patch:{asrMode:'volcengine'}})
  await f.host.command({action:'settings',patch:{asrEnableEmotionDetection:true,asrRecognitionMode:'utterance'}})
  await f.host.command({action:'settings',patch:{asrModel:'bigmodel-1.0'}})
  let state=await f.host.state()
  assert.equal(state.settings.asrResourceId,'volc.bigasr.sauc.duration')
  assert.equal(state.settings.asrRecognitionMode,'realtime')
  assert.equal(state.settings.asrEndpoint,'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async')
  assert.equal(state.settings.asrEnableEmotionDetection,false)
  await f.host.command({action:'settings',patch:{asrModel:'bigmodel'}})
  state=await f.host.state()
  assert.equal(state.settings.asrResourceId,'volc.seedasr.sauc.duration')
  assert.equal(state.settings.asrEnableEmotionDetection,true)
  assert.equal(state.settings.asrRecognitionMode,'utterance')
  await f.host.dispose()
})
