import test from 'node:test'
import assert from 'node:assert/strict'
import { installNativeManagement } from '../src/native-management.mjs'
function fixture() {
  const tools=new Map(),records=new Map();let sent=0,fail=false
  const agent={id:'owner',session:{header:{cwd:'C:/workspace'}},ctx:{systemPrompt:{section:()=>()=>{}},tools:{register(tool){tools.set(tool.name,tool);return()=>tools.delete(tool.name)}}}}
  const ctx={sessionController:{
    async list({sessionIds}){return {items:sessionIds.map(sessionId=>({sessionId,cwd:sessionId==='outside'?'D:/other':'C:/workspace'}))}},
    async prompt(){sent++;if(fail)throw Error('uncertain transport');return {accepted:true}},
    async state(){return {running:true}},
  }}
  const off=installNativeManagement({ctx,agent,settings:()=>({manageAllWorkspaces:false}),ledger:{get:key=>records.get(key),async put(key,value){records.set(key,value)}},defineTool:value=>value})
  const invoke=(name,args,callId='tool-1',owner=agent)=>tools.get(name).execute(args,{callId,agent:owner,signal:new AbortController().signal})
  return {invoke,off,tools,sent:()=>sent,fail:()=>{fail=true}}
}
test('native management enforces caller and target scope before dispatch',async()=>{
  const f=fixture()
  await assert.rejects(f.invoke('dsh_session_state',{sessionId:'target'},'call',{id:'other'}),/OWNER_MISMATCH/)
  await assert.rejects(f.invoke('dsh_session_send',{sessionId:'outside',text:'x'}),/TARGET_NOT_ALLOWED/)
  assert.equal(f.sent(),0);f.off();assert.equal(f.tools.size,0)
})
test('same accepted tool call returns receipt, uncertain dispatch never automatically repeats',async()=>{
  const f=fixture(),args={sessionId:'target',text:'work'}
  const first=await f.invoke('dsh_session_send',args);assert.equal(first.status,'accepted')
  assert.deepEqual(await f.invoke('dsh_session_send',args),first);assert.equal(f.sent(),1)
  await assert.rejects(f.invoke('dsh_session_send',{...args,text:'different'}),/REQUEST_CONFLICT/)
  f.fail();await assert.rejects(f.invoke('dsh_session_send',args,'tool-2'),/uncertain/)
  assert.equal((await f.invoke('dsh_session_send',args,'tool-2')).status,'uncertain');assert.equal(f.sent(),2)
})
test('partial native tool registration rolls back and cleanup continues after one release fails',()=>{
  let sections=0,installed=0,released=0
  const agent={ctx:{systemPrompt:{section(){sections++;return()=>{sections--}}},tools:{register(){
    if(++installed===3)throw Error('REGISTER_FAILED')
    return()=>{released++;if(released===1)throw Error('RELEASE_FAILED')}
  }}}}
  assert.throws(()=>installNativeManagement({ctx:{},agent,settings:()=>({}),ledger:{},defineTool:v=>v}),/MANAGEMENT_ATTACH_FAILED/)
  assert.equal(installed,3);assert.equal(released,2);assert.equal(sections,0)
})
