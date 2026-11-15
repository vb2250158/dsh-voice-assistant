import test from 'node:test'
import assert from 'node:assert/strict'
import {createSettingsStore} from './generated/settings-store.js'
import {createAsrMigration} from '../src/asr-migration.mjs'

test('migrates an existing Volcano profile without changing the selected provider or later preferences',async()=>{
  let value={},revision=0,marker
  const service={describe:()=>[{ns:'voice',value,revision}],async update(_ns,next,expected){assert.equal(expected,revision);value=next;revision++}}
  const store=createSettingsStore(service,'voice',()=>value)
  await store.saveBatch([{asrMode:'volcengine'},{asrEnableEmotionDetection:false,asrUseContext:false,asrSystemReservedFilter:true,asrFilterWithEmpty:'test'}, {asrMode:'compatible'}])
  const ledger={get:()=>marker,async put(_key,next){marker=next}}
  const fields=[{key:'asrEnableEmotionDetection',type:'boolean',feature:true},{key:'asrUseContext',type:'boolean',feature:true}]
  const migration=createAsrMigration({store,ledger,fields})
  await migration.run()
  assert.equal(store.read().asrMode,'compatible')
  await store.save({asrMode:'volcengine'})
  const config=store.read()
  assert.equal(config.asrEnableEmotionDetection,true);assert.equal(config.asrUseContext,true)
  assert.equal(config.asrRecognitionMode,'twopass');assert.equal(config.asrSystemReservedFilter,false);assert.equal(config.asrFilterWithEmpty,'')
  await store.save({asrEnableEmotionDetection:false});await migration.run()
  assert.equal(store.read().asrEnableEmotionDetection,false)
  await migration.close();await store.close()
})
