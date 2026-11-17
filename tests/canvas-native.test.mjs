import test from 'node:test'
import assert from 'node:assert/strict'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { canvasProjection, installNativeCanvas } from './generated/canvas-native.js'
import { projectCanvasHistory } from './generated/canvas-history.js'
const document={title:'图表',nodes:[{kind:'text',x:0,y:0,width:400,height:80,text:'第一季度',fontSize:28}]}
const fixture=(saved=null)=>{
 let state={value:saved},definition,observed=[],epoch=0,turnEpoch=0
 const session={append(type,data,options){state=canvasProjection.apply(state,{type,data,...options})}}
 const agent={id:'assistant',session,ctx:{systemPrompt:{section:()=>()=>{}},tools:{register(value){definition=value;return()=>{definition=undefined}}}}}
 const installed=installNativeCanvas({agent,projection:{readerFor:()=>()=>state},defineTool,currentPosition:()=>({inputEpoch:turnEpoch,responseId:'a:1:1'}),onChange:value=>observed.push(value)})
 return {agent,installed,get state(){return state},get tool(){return definition},get observed(){return observed},begin(){epoch=installed.canvas.beginInput()},admit(){turnEpoch=epoch}}
}
test('native canvas tool records persistent state and restores it from session projection',async()=>{
 const f=fixture(),call=(args)=>f.tool.execute(args,{agent:f.agent,signal:new AbortController().signal})
 const value=await call({action:'show',persistent:true,document})
 assert.equal(value.canvas.title,'图表');assert.equal(f.state.value.document.title,'图表');assert.equal(f.observed.length,1)
 const restored=fixture(f.state.value);assert.equal(restored.installed.canvas.snapshot().visible,true)
 restored.begin();assert.equal(restored.installed.canvas.snapshot().visible,true)
 restored.installed.dispose();f.installed.dispose()
})
test('new input hides temporary canvas and rejects stale tool work',async()=>{
 const f=fixture(),call=(args)=>f.tool.execute(args,{agent:f.agent,signal:new AbortController().signal})
 await call({action:'show',document});f.begin();assert.equal(f.state.value.visible,false)
 await assert.rejects(call({action:'show',document}),/ASSISTANT_CANVAS_STALE_TURN/)
 f.admit();await call({action:'show',document});assert.equal(f.state.value.visible,true)
 f.installed.dispose()
})
test('history uses successful recorded calls and ignores malformed or failed calls',()=>{
 const entry=(seq,args,isError=false)=>({kind:'tool-result',seq,callId:String(seq),name:'assistant_canvas',call:{argsRaw:JSON.stringify(args)},isError})
 const snapshot={eventNodes:[entry(1,{action:'show',document}),entry(2,{action:'show',document},true),entry(3,{action:'show',document:{}})],eventLocations:new Map([1,2,3].map(seq=>[seq,{kind:'step',turn:{turn:1},step:{step:seq}}]))}
 const history=projectCanvasHistory(snapshot);assert.equal(history.size,1);assert.equal(history.get('a:1:1').document.title,'图表')
})
