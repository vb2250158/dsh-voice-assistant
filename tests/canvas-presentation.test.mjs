import test from 'node:test'
import assert from 'node:assert/strict'
import {conversationMessages} from '../src/conversation-messages.mjs'
import {observeSessionOutput} from '../src/session-output.mjs'
import {projectCanvasHistory} from './generated/canvas-history.js'
const document={title:'图表',nodes:[{kind:'text',x:0,y:0,width:400,height:80,text:'销量',fontSize:28}]}
test('native history renders a canvas even when its assistant step has no text',()=>{
 const events={eventNodes:[{kind:'tool-result',seq:5,name:'assistant_canvas',isError:false,call:{argsRaw:JSON.stringify({action:'show',document})}}],eventLocations:new Map([[5,{kind:'step',turn:{turn:2},step:{step:1}}]])}
 const node={key:'answer',kind:'assistant-step',visibility:'hidden',data:{turn:2,step:1,blocks:[]}}
 const items=conversationMessages({order:['answer'],nodes:new Map([['answer',node]])},100,undefined,new Set(),projectCanvasHistory(events))
 assert.equal(items.length,1);assert.equal(items[0].canvas.document.title,'图表')
})
test('native canvas changes are forwarded to the desktop presentation',()=>{
 let current={revision:0},listener,seen=[]
 const stop=observeSessionOutput({eventSource:{getSnapshot:()=>current,subscribe:fn=>{listener=fn;return()=>{listener=undefined}}},voice:{},onError:error=>{throw error},onCanvas:value=>seen.push(value)})
 current={revision:1,change:{kind:'canvas',value:{visible:true,document}}};listener()
 assert.equal(seen[0].document.title,'图表');stop();assert.equal(listener,undefined)
})
