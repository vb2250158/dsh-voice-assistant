import test from 'node:test'
import assert from 'node:assert/strict'
import {createSpeechCredentials} from './generated/speech-credentials.js'
test('changing service endpoint cannot forward the old key or expose it through settings presence',async()=>{
  const records=new Map(),secret='test-value-only'
  const api=createSpeechCredentials({readRecord:async key=>records.get(key),describeRecord:async key=>({configured:records.has(key),writable:true}),
    modifyRecord:async(key,fn)=>records.set(key,await fn(records.get(key))),deleteRecord:async key=>records.delete(key)},(scope,id)=>scope+'/'+id)
  await api.set('tts','https://speech.example/v1/audio/speech',secret)
  assert.equal(await api.resolve('tts','https://other.example/v1/audio/speech'),undefined)
  assert.equal(await api.resolve('asr','https://speech.example/v1/audio/speech'),undefined)
  assert.equal(await api.resolve('tts','https://speech.example/v1/audio/speech'),secret)
  assert.equal(JSON.stringify(await api.describe('tts','https://speech.example/v1/audio/speech')).includes(secret),false)
  await assert.rejects(api.set('tts','http://external.example/tts',secret),/TLS/)
})

test('Volcengine credentials are isolated by kind and endpoint and use valid DSH key segments',async()=>{
  const records=new Map()
  const api=createSpeechCredentials({readRecord:async key=>records.get(key),describeRecord:async key=>({configured:records.has(key),writable:true}),
    modifyRecord:async(key,fn)=>records.set(key,await fn(records.get(key))),deleteRecord:async key=>records.delete(key)},(scope,id)=>{
      assert.match(id,/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      return scope+'/'+id
    })
  const endpoint='wss://openspeech.bytedance.com/api/v3/tts/bidirection'
  await api.set('tts',endpoint,'volc-test-key','volcengine')
  assert.equal(await api.resolve('tts',endpoint,'volcengine'),'volc-test-key')
  assert.equal(await api.resolve('asr',endpoint,'volcengine'),undefined)
  assert.equal(await api.resolve('tts','wss://openspeech.bytedance.com/api/v3/tts/other','volcengine'),undefined)
  await assert.rejects(api.resolve('tts',endpoint,'compatible'),/SPEECH_ENDPOINT/)
})
