import test from 'node:test'
import assert from 'node:assert/strict'
import {projectNativeExecution,projectNativeActivity,safeExecutionValue} from '../src/native-execution-projection.mjs'
const location=(turn,step)=>({kind:'step',turn:{turn},step:{step}})
test('native trajectory maps recorded model settings and actual tool result to the owning turn',()=>{
 const s={requests:[{purpose:'assistant',turn:1,step:1,startSeq:2,startedAt:10,completedAt:15,status:'complete',requestConfig:{provider:'p',model:'m'}},{purpose:'assistant',turn:1,step:2,startSeq:6,startedAt:30,status:'running'},{purpose:'assistant',turn:2,step:1,startSeq:9,startedAt:40,status:'running'}],
  eventNodes:[{kind:'tool-result',seq:5,callId:'c',name:'web_search',call:{argsRaw:'{"q":"x","apiKey":"fake-key"}'},callTime:20,time:25,isError:false,content:[{type:'text',text:'actual'}]}],eventLocations:new Map([[5,location(1,1)]]),runningCalls:[]}
 const detail=projectNativeExecution(s,'a:1:2');assert.deepEqual(detail.steps.map(step=>step.kind),['model','tool','model']);assert.equal(detail.steps[0].request.model,'m');assert.equal(detail.steps[1].arguments.apiKey,'[已隐藏]');assert.equal(detail.steps[1].outcome.content[0].text,'actual');assert.equal(detail.status,'running')
 assert.equal(projectNativeExecution(s,'u:1'),undefined)
})
test('footer contains just the active call, never arguments or results',()=>{
 const call={phase:'start',turn:1,step:2,name:'tool',callId:'x',time:1,argsRaw:'{"operation":"search","password":"fake"}'}
 assert.deepEqual(projectNativeActivity({runningCalls:[call]}),{status:'executing-tool',responseId:'a:1:2',tool:{callId:'x',name:'tool',operation:'search'}})
 assert.equal(projectNativeActivity({runningCalls:[]}),undefined)
 assert.equal(projectNativeActivity({runningCalls:[{...call,phase:'preparing'}]}),undefined)
})
test('missing history is uncertain and secret-looking strings are masked',()=>{
 assert.equal(projectNativeExecution({requests:[],eventNodes:[],runningCalls:[]},'a:1:2').status,'uncertain')
 const value=safeExecutionValue({authorization:'fake-value',result:'Bearer fake-token-12345678'})
 assert.equal(value.authorization,'[已隐藏]');assert.equal(value.result,'Bearer [已隐藏]')
 assert.equal(safeExecutionValue('https://example.test/?api_key=hidden-value&x=1'), 'https://example.test/?api_key=[已隐藏]&x=1')
 assert.equal(safeExecutionValue('token=hidden-value'), 'token=[已隐藏]')
})
