import test from 'node:test'
import assert from 'node:assert/strict'
import {createAsrMigration} from '../src/asr-migration.mjs'

test('existing provider choice is restored and capability migration is applied only once',async()=>{
  let marker,writes=0,patches
  const store={read:()=>({asrMode:'compatible'}),async saveBatch(value){writes++;patches=value}}
  const ledger={get:()=>marker,async put(_key,value){marker=value}}
  const migration=createAsrMigration({store,ledger,fields:[{feature:true,type:'boolean',key:'asrEnableLid'},
    {feature:true,type:'boolean',key:'asrUseContext'},{type:'boolean',key:'asrSystemReservedFilter'}]})
  await Promise.all([migration.run(),migration.run()])
  assert.equal(writes,1);assert.deepEqual(patches,[{asrMode:'volcengine'},
    {asrEnableLid:true,asrUseContext:true,asrRecognitionMode:'twopass',asrSystemReservedFilter:false,asrFilterWithEmpty:'',asrFilterWithSigned:''},
    {asrMode:'compatible'}])
  await migration.run();assert.equal(writes,1);await migration.close()
  await assert.rejects(migration.run(),/CLOSED/)
})
test('a settings failure does not record completion and can be retried',async()=>{
  let marker,tries=0
  const migration=createAsrMigration({store:{read:()=>({asrMode:'volcengine'}),async saveBatch(){if(++tries===1)throw Error('WRITE_FAILED')}},
    ledger:{get:()=>marker,async put(_key,value){marker=value}},fields:[]})
  await assert.rejects(migration.run(),/WRITE_FAILED/);assert.equal(marker,undefined)
  await migration.run();assert.equal(tries,2);assert.equal(marker.applied,true);await migration.close()
})
