import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
const require=createRequire(process.env.VOICE_TEST_PACKAGE_ROOT?process.env.VOICE_TEST_PACKAGE_ROOT+'/package.json':import.meta.url)
const React=require('react'),renderer=require('react-test-renderer')
test('built shared presenter uses native history and closing it never stops Host audio',async()=>{
  const calls=[],slots=new Map();let descriptor,released=0,created=0
  const state={sessionId:'owned-session',voice:{phase:'running',capture:'listening',outputEnabled:true},presentation:{statusText:'正在聆听'},
    settings:{persona:'editable',asrMode:'native',ttsEndpoint:'https://tts.example/',captionSkin:'dark'},credentials:{asr:{},tts:{}},pet:{available:false}}
  const window={__ModuleLoader__:{load(value){descriptor=value}}}
  const script=await readFile(new URL('../dist/client.js',import.meta.url),'utf8')
  runInNewContext(script,{window,location:{href:'http://localhost/'},URL,crypto:globalThis.crypto,console,setTimeout,clearTimeout,
    navigator:{mediaDevices:{getUserMedia(){assert.fail('GUI must not open microphone')}}},
    fetch:async(_url,options)=>{if(options.body)calls.push(JSON.parse(options.body));return {ok:true,json:async()=>state}}})
  const primitives={Button:p=>React.createElement('button',p,p.children),Input:p=>React.createElement('input',p),
    Modal:p=>p.open?React.createElement('section',null,p.children):null,IconMicrophoneOutlineRegular:()=>null}
  const plugin=descriptor.factory(name=>name==='react'?React:primitives)
  const ctx={effect:fn=>fn(),provide(){},layout:{selectPanel(){}},locale:{register:()=>()=>{},bind:()=>()=>''},
    slots:{inject:(_name,fn)=>fn(),register:(spec,component)=>{slots.set(spec.name,component);return()=>{}}},
    sessions:{create(){created++;throw Error('client cannot create')},retain(id){assert.equal(id,'owned-session');return {ready:Promise.resolve({}),release(){released++}}}},
    uiConversation:{binding(){return {target:()=>({getSnapshot:()=>({order:['history'],nodes:new Map([['history',{key:'history',kind:'assistant-step',visibility:'visible',data:{blocks:[{kind:'text',text:'durable answer'}]}}]])}),subscribe:()=>()=>{}})}}}}
  plugin.apply(ctx);let view
  await renderer.act(async()=>{view=renderer.create(React.createElement(slots.get('main')));for(let i=0;i<15;i++)await Promise.resolve()})
  assert.equal(created,0);assert.deepEqual(calls.map(x=>x.action),['prepare'])
  assert.ok(JSON.stringify(view.toJSON()).includes('durable answer'))
  await renderer.act(async()=>{view.unmount();await Promise.resolve()})
  assert.equal(released,1);assert.deepEqual(calls.map(x=>x.action),['prepare'])
})
