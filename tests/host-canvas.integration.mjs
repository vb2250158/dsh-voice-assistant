import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {createNativeSession} from '../src/native-session.mjs'
import {canvasProjection,installNativeCanvas} from './generated/canvas-native.js'
const core=process.env.VOICE_TEST_DSH_CORE
if(!core)throw Error('VOICE_TEST_DSH_CORE required')
const requireBoot=createRequire(pathToFileURL(join(core,'packages/boot/app-boot/package.json')))
const {Context}=await import(pathToFileURL(requireBoot.resolve('@deepseek-ai/cordis')))
const load=path=>import(pathToFileURL(join(core,'packages',path,'lib/index.js')))
const [llm,store,registry,system,tools,executor,agents,loop]=await Promise.all([load('llm/llm'),load('core/session'),load('session/session-projection'),load('core/system-prompt'),load('core/tools'),load('core/tool-executor-native'),load('core/agent'),load('core/agent-loop')])
const chart={title:'季度销量',nodes:[{kind:'text',x:0,y:0,width:400,height:80,text:'第一季度',fontSize:28}]}
test('real DSH model invokes canvas and sees persistent state on its next request',{timeout:10000},async()=>{
 class Adapter extends llm.LlmAdapter{
  requests=[]
  async resolveModel(provider,model){return{provider,id:model,name:model}}
  async *stream(request){
   this.requests.push(request)
   if(this.requests.length===1){const args=JSON.stringify({action:'show',persistent:true,document:chart}),id=llm.ToolCallId('canvas-1');yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id,name:'assistant_canvas',argumentsDelta:args};yield{type:'block-end',index:0,block:{type:'tool-call',id,name:'assistant_canvas',arguments:args}};yield{type:'finish',reason:{kind:'tool-calls'}}}
   else{yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text:'完成'};yield{type:'block-end',index:0,block:{type:'text',text:'完成'}};yield{type:'finish',reason:{kind:'stop'}}}
  }
 }
 const ctx=new Context(),adapter=new Adapter();let native,handle
 try{
  for(const plugin of [llm.default,store.default,registry.default,system.default,tools.default,executor,agents.default])await ctx.plugin(plugin)
  await ctx.plugin(loop.default,{agents:[]});ctx.llm.registerAdapter(['mock'],adapter)
  await ctx.plugin({inject:['sessionProjections'],async apply(owner){handle=await owner.sessionProjections.register(canvasProjection)}})
  const agent=await ctx.agentLoop.create(store.SessionId('canvas-integration'),{provider:'mock',model:'mock'})
  const controller={async resolveAgent(){return{agent}},async prompt(request){agent.followup(llm.createUserMessage({content:request.content,source:{kind:'user',rpcId:request.requestId}}));return{accepted:true}}}
  native=createNativeSession({on:ctx.on.bind(ctx),sessionController:controller},{settings:()=>({persona:'Assistant'}),binding:{get:()=>({sessionId:agent.id})},canvasContext:handle,defineTool:tools.defineTool,installNativeCanvas})
  const idle=new Promise(resolve=>{const off=ctx.on('agent/status',({agent:subject,status})=>{if(subject===agent&&status==='idle'){off();resolve()}})})
  await native.submit('画图','request-1234');await idle
  assert.equal(adapter.requests.length,2);assert.equal(native.canvasState().document.title,'季度销量')
  assert.match(JSON.stringify(adapter.requests[1].messages),/季度销量/)
  assert.equal(handle.readerFor(agent.session)().value.document.title,'季度销量')
  assert.ok(agent.session.snapshotEvents().some(event=>event.type==='dsh-voice-assistant/canvas'))
  native.close()
  native=createNativeSession({on:ctx.on.bind(ctx),sessionController:controller},{settings:()=>({persona:'Assistant'}),binding:{get:()=>({sessionId:agent.id})},canvasContext:handle,defineTool:tools.defineTool,installNativeCanvas})
  await native.open();assert.equal(native.canvasState().document.title,'季度销量')
  const nextIdle=new Promise(resolve=>{const off=ctx.on('agent/status',({agent:subject,status})=>{if(subject===agent&&status==='idle'){off();resolve()}})})
  await native.submit('这张图是什么','request-5678');await nextIdle
  assert.match(JSON.stringify(adapter.requests[2].messages),/季度销量/)
 }finally{native?.close();await ctx.fiber.dispose()}
})
