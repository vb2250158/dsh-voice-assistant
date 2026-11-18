import test from 'node:test'
import assert from 'node:assert/strict'
import {projectNativeActivity} from '../src/native-execution-projection.mjs'
import {subscribeConversation} from '../src/subscribe-conversation.mjs'
const flush=()=>new Promise(resolve=>setImmediate(resolve))
test('native model activity reflects only the current unfinished assistant request',()=>{
 const request={purpose:'assistant',status:'running',turn:2,step:3}
 assert.deepEqual(projectNativeActivity({requests:[request]}),{status:'thinking',responseId:'a:2:3'})
 assert.equal(projectNativeActivity({requests:[{...request,status:'complete'}]}),undefined)
 assert.equal(projectNativeActivity({requests:[{...request,purpose:'title'}]}),undefined)
})
test('waiting message is removed on failure and replaced by native streamed text',async()=>{
 let change,requests=[{purpose:'assistant',status:'running',turn:2,step:1}],nodes=new Map(),order=[]
 const chat={getSnapshot:()=>({order,nodes}),subscribe:()=>()=>{}}
 const trajectory={getSnapshot:()=>({requests,eventNodes:[],runningCalls:[]}),subscribe:fn=>{change=fn;return()=>{}}}
 const ctx={sessions:{ensureListed:async()=>true,retain:()=>({ready:Promise.resolve({}),release(){}})},uiConversation:{binding:()=>({target:name=>name==='chat'?chat:trajectory})}}
 const received=[];const stop=subscribeConversation(ctx,'session',value=>received.push(value),error=>{throw error})
 await flush();assert.deepEqual(received.at(-1).map(x=>[x.id,x.text]),[['a:2:1','']])
 nodes=new Map([['a',{key:'a',kind:'assistant-step',visibility:'visible',data:{turn:2,step:1,blocks:[{kind:'text',text:'你好'}]}}]]);order=['a'];change()
 assert.deepEqual(received.at(-1).map(x=>[x.id,x.text]),[['a:2:1','你好']])
 nodes=new Map();order=[];requests=[{...requests[0],status:'error'}];change();assert.deepEqual(received.at(-1),[])
 stop()
})
