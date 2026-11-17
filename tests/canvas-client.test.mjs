import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
const require=createRequire(import.meta.url),React=require('react'),renderer=require('react-test-renderer')
test('built DSH panel renders native tool-only canvas and hides text input by default',async()=>{
 const doc={title:'季度图',nodes:[{kind:'text',x:0,y:0,width:200,height:80,text:'销量',fontSize:28}]}
 const chatNode={key:'answer',kind:'assistant-step',visibility:'hidden',data:{turn:1,step:1,blocks:[]}}
 const chat={order:['answer'],nodes:new Map([['answer',chatNode]])}
 const trajectory={requests:[],runningCalls:[],eventNodes:[{kind:'tool-result',seq:2,name:'assistant_canvas',isError:false,call:{argsRaw:JSON.stringify({action:'show',document:doc})}}],eventLocations:new Map([[2,{kind:'step',turn:{turn:1},step:{step:1}}]])}
 const state={sessionId:'session',capabilities:{host:'dsh',hostModels:[]},voice:{phase:'stopped',capture:'idle',outputEnabled:true},presentation:{statusText:''},settings:{persona:'',asrMode:'native',ttsEndpoint:'https://example.test',captionSkin:'dark'},credentials:{asr:{},tts:{}},pet:{available:false}}
 let descriptor,view;const slots=new Map(),window={__ModuleLoader__:{load(value){descriptor=value}}}
 runInNewContext(await readFile(new URL('../dist/client.js',import.meta.url),'utf8'),{window,location:{href:'http://localhost/'},URL,crypto:globalThis.crypto,console,setTimeout,clearTimeout,navigator:{},fetch:async()=>({ok:true,json:async()=>state})})
 const primitives={Button:p=>React.createElement('button',p,p.children),Input:p=>React.createElement('input',p),IconMicrophoneOutlineRegular:()=>null}
 const plugin=descriptor.factory(name=>name==='react'?React:primitives)
 plugin.apply({effect:fn=>fn(),provide(){},layout:{selectPanel(){}},locale:{register:()=>()=>{},bind:()=>key=>key},slots:{inject:(_name,fn)=>fn(),register:(spec,component)=>{slots.set(spec.name,component);return()=>{}}},sessions:{ensureListed:async()=>true,retain:()=>({ready:Promise.resolve({}),release(){}})},uiConversation:{binding:()=>({target:name=>({getSnapshot:()=>name==='chat'?chat:trajectory,subscribe:()=>()=>{}})})}})
 try{
  await renderer.act(async()=>{view=renderer.create(React.createElement(slots.get('main')));for(let i=0;i<15;i++)await Promise.resolve()})
  assert.equal(view.root.findAllByType('canvas').length,1)
  assert.equal(view.root.findAllByType('input').some(input=>input.props['aria-label']==='消息'),false)
  assert.ok(JSON.stringify(view.toJSON()).includes('季度图'))
 }finally{if(view)await renderer.act(async()=>{view.unmount()})}
})
