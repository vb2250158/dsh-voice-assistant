import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
const require=createRequire(process.env.VOICE_TEST_PACKAGE_ROOT?process.env.VOICE_TEST_PACKAGE_ROOT+'/package.json':import.meta.url)
const React=require('react'),renderer=require('react-test-renderer')
test('built shared presenter uses native history and closing it never stops Host audio',async t=>{
  const calls=[],slots=new Map();let descriptor,released=0,created=0,notifyConversation
  let conversationSnapshot={order:['history'],nodes:new Map([['history',{key:'history',kind:'assistant-step',visibility:'visible',data:{blocks:[{kind:'text',text:'durable answer'}]}}]])}
  const state={sessionId:'owned-session',selectedModel:{provider:'test',model:'test-model'},capabilities:{host:'dsh',textInput:true,keywordWake:true,hostModels:[{provider:'test',model:'test-model',label:'Test model',providerLabel:'Test'}]},voice:{phase:'running',capture:'listening',outputEnabled:true},presentation:{statusText:'正在聆听'},
    settings:{voiceEnabled:true,persona:'editable',asrMode:'native',ttsEndpoint:'https://tts.example/',captionSkin:'dark',captionFontSize:24,captionOpacity:.85,keywordWakeEnabled:true,keywordWakeAliases:'小助手'},credentials:{asr:{},tts:{}},pet:{available:false}}
  const window={__ModuleLoader__:{load(value){descriptor=value}}}
  const script=await readFile(new URL('../dist/client.js',import.meta.url),'utf8')
  runInNewContext(script,{window,location:{href:'http://localhost/'},URL,crypto:globalThis.crypto,console,setTimeout,clearTimeout,
    navigator:{mediaDevices:{getUserMedia(){assert.fail('GUI must not open microphone')}}},
    fetch:async(_url,options)=>{if(options.body){const value=JSON.parse(options.body);calls.push(value);if(value.action==='settings')Object.assign(state.settings,value.patch);if(value.action==='devices')return {ok:false,json:async()=>({error:'DEVICE_ELECTRON_NOT_FOUND'})}}return {ok:true,json:async()=>state}}})
  const primitives={Button:p=>React.createElement('button',p,p.children),
    Switch:({label,checked,onChange,disabled})=>React.createElement('button',{role:'switch','aria-label':label,'aria-checked':checked,disabled,onClick:()=>onChange(!checked)},React.createElement('span')),
    Input:React.forwardRef((p,ref)=>React.createElement('span',{className:'dsh-input-wrapper'},React.createElement('input',{...p,ref}))),
    Modal:p=>p.open?React.createElement('section',null,p.children):null,IconMicrophoneOutlineRegular:()=>null}
  const plugin=descriptor.factory(name=>name==='react'?React:primitives)
  const ctx={effect:fn=>fn(),provide(){},layout:{selectPanel(){}},locale:{register:()=>()=>{},bind:()=>key=>key==='back'?'返回':''},
    slots:{inject:(_name,fn)=>fn(),register:(spec,component)=>{slots.set(spec.name,component);return()=>{}}},
    sessions:{ensureListed:async()=>true,create(){created++;throw Error('client cannot create')},retain(id){assert.equal(id,'owned-session');return {ready:Promise.resolve({}),release(){released++}}}},
    uiConversation:{binding(){return {target:()=>({getSnapshot:()=>conversationSnapshot,subscribe:fn=>{notifyConversation=fn;return()=>{notifyConversation=undefined}}})}}}}
  plugin.apply(ctx);let view
  t.after(()=>renderer.act(()=>view?.unmount()))
  await renderer.act(async()=>{view=renderer.create(React.createElement(slots.get('main')));for(let i=0;i<15;i++)await Promise.resolve()})
  assert.equal(view.toJSON().props.className,'dsh-voice-assistant-panel')
  assert.equal(created,0);assert.deepEqual(calls.map(x=>x.action),['prepare'])
  assert.ok(JSON.stringify(view.toJSON()).includes('durable answer'))
  const voiceToggle=()=>view.root.findAllByType('button').find(button=>button.props.role==='switch')
  assert.equal(voiceToggle().props['aria-label'],'语音助手')
  assert.equal(voiceToggle().props['aria-checked'],true)
  assert.equal(view.root.findByProps({className:'dsh-voice-toggle'}).findByType('button'),voiceToggle())
  assert.equal(voiceToggle().findAllByType('span').length,1)
  await renderer.act(async()=>{voiceToggle().props.onClick()})
  assert.equal(voiceToggle().props['aria-checked'],false)
  assert.deepEqual(calls.splice(1),[{action:'settings',patch:{voiceEnabled:false}}])
  await renderer.act(async()=>{view.root.findAllByType('button').find(button=>button.props.children==='设置').props.onClick();await Promise.resolve()})
  assert.equal(view.root.findByProps({className:'dsh-voice-settings-page'}).findByProps({className:'va-settings'}).type,'div')
  await renderer.act(async()=>{view.root.findAllByType('button').find(button=>button.props.children==='外观').props.onClick()})
  const captionFields=view.root.findAllByType('input').filter(input=>input.props.type==='number')
  assert.ok(captionFields.some(input=>input.props['aria-label']?.startsWith('字号')&&input.props.value===24))
  assert.ok(captionFields.some(input=>input.props['aria-label']?.startsWith('背景透明度')&&input.props.value===.85))
  assert.ok(captionFields.every(input=>input.parent.type==='label'))
  await renderer.act(async()=>{view.root.findAllByType('button').find(button=>button.props.children==='设备').props.onClick()})
  const wakeInput=view.root.findAllByType('input').find(input=>input.props.value==='小助手')
  assert.equal(wakeInput?.parent.type,'label')
  await renderer.act(async()=>{view.root.findAllByType('button').find(button=>button.props.children==='刷新设备').props.onClick();for(let i=0;i<15;i++)await Promise.resolve()})
  assert.ok(JSON.stringify(view.toJSON()).includes('未找到 Electron'))
  assert.ok(JSON.stringify(view.toJSON()).includes('当前 DSH Home'))
  assert.equal(view.root.findAllByType('input').some(input=>input.props['aria-label']==='消息'),false)
  await renderer.act(async()=>{view.root.findAllByType('button').find(button=>button.props.children==='返回').props.onClick();await Promise.resolve()})
  await renderer.act(async()=>{view.root.findAllByType('input').find(input=>input.props['aria-label']==='消息').props.onChange({target:{value:'hello'}});await Promise.resolve()})
  await renderer.act(async()=>{view.root.findAllByType('button').find(button=>button.props.children==='发送').props.onClick();for(let i=0;i<15;i++)await Promise.resolve()})
  assert.equal(calls.filter(call=>call.action==='text').length,1)
  const failure={key:'failure',kind:'turn-error',visibility:'visible',data:{code:'MISSING_CREDENTIAL',message:'',turn:1,step:1,seq:2,time:1}}
  conversationSnapshot={order:['failure'],nodes:new Map([['failure',failure]])}
  await renderer.act(async()=>{notifyConversation();await Promise.resolve()})
  assert.ok(JSON.stringify(view.toJSON()).includes('当前对话模型缺少凭据'))
  assert.ok(view.root.findAllByType('article').some(node=>node.props.role==='alert'))
  assert.equal(JSON.stringify(view.toJSON()).includes('已受理'),false)
  assert.equal(calls.filter(call=>call.action==='text').length,1,'failure projection never retries native work')
  await renderer.act(async()=>{view.unmount();await Promise.resolve()})
  assert.equal(released,1);assert.deepEqual(calls.map(x=>x.action),['prepare','devices','text'])
  await renderer.act(async()=>{view=renderer.create(React.createElement(slots.get('main')));for(let i=0;i<15;i++)await Promise.resolve()})
  assert.ok(JSON.stringify(view.toJSON()).includes('当前对话模型缺少凭据'),'reopening reads the durable native failure')
  assert.equal(calls.filter(call=>call.action==='text').length,1)
  await renderer.act(async()=>{view.unmount();await Promise.resolve()})
  assert.equal(released,2)
  assert.deepEqual(calls.map(x=>x.action),['prepare','devices','text','prepare'])
})
