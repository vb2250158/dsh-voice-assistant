import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createNativeSession } from '../src/native-session.mjs'
import { observeSessionOutput } from '../src/session-output.mjs'
const core=process.env.VOICE_TEST_DSH_CORE
if(!core)throw Error('VOICE_TEST_DSH_CORE required')
const requireBoot=createRequire(pathToFileURL(join(core,'packages/boot/app-boot/package.json')))
const {Context}=await import(pathToFileURL(requireBoot.resolve('@deepseek-ai/cordis')))
const load=path=>import(pathToFileURL(join(core,'packages',path,'lib/index.js')))
const [llm,store,registry,system,tools,executor,agents,loop]=await Promise.all([
  load('llm/llm'),load('core/session'),load('session/session-projection'),load('core/system-prompt'),
  load('core/tools'),load('core/tool-executor-native'),load('core/agent'),load('core/agent-loop'),
])

test('real native tool stream seals spoken text before tool execution and resumes after the tool',async()=>{
  const events=[]
  class Adapter extends llm.LlmAdapter{
    calls=0
    async resolveModel(provider,model){return{provider,id:model,name:model}}
    async *stream(){
      this.calls++
      const text=this.calls===1?'先查一下。':'查到了。'
      yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}}
      if(this.calls===1){const callId=llm.ToolCallId('call-1');yield {type:'block-start',index:1,blockType:'tool-call'};yield {type:'tool-call-delta',index:1,id:callId,name:'echo',argumentsDelta:'{}'};yield {type:'block-end',index:1,block:{type:'tool-call',id:callId,name:'echo',arguments:'{}'}};yield {type:'finish',reason:{kind:'tool-calls'}}}
      else yield {type:'finish',reason:{kind:'stop'}}
    }
  }
  const ctx=new Context(),adapter=new Adapter();let native,stop
  try{
    for(const plugin of [llm.default,store.default,registry.default,system.default,tools.default,executor,agents.default])await ctx.plugin(plugin)
    await ctx.plugin(loop.default,{agents:[]});ctx.llm.registerAdapter(['mock'],adapter)
    ctx.tools.register(tools.defineTool({name:'echo',description:'test tool',parameters:{},output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(){events.push('tool');return {ok:true}}}))
    const agent=await ctx.agentLoop.create(store.SessionId('native-segment-test'),{provider:'mock',model:'mock'})
    const controller={async resolveAgent(){return{agent}},async prompt(request){agent.followup(llm.createUserMessage({content:request.content,source:{kind:'user',rpcId:request.requestId}}));return{accepted:true}}}
    native=createNativeSession({on:ctx.on.bind(ctx),sessionController:controller},{settings:()=>({persona:'Assistant'}),binding:{get:()=>({sessionId:agent.id})}})
    const voice={beginResponse(){let buffered=false;return{append(text){events.push(text);buffered=true},finishSpeechSegment(){if(buffered){events.push('segment');buffered=false}},finish(){events.push('finish')}}},interruptSpeech(){events.push('interrupt')}}
    stop=observeSessionOutput({eventSource:native.eventSource,voice,onError:error=>{throw error}})
    const idle=new Promise(resolve=>{const off=ctx.on('agent/status',({agent:subject,status})=>{if(subject===agent&&status==='idle'){off();resolve()}})})
    await native.submit('查询','request-1234');await idle
    assert.equal(adapter.calls,2)
    assert.ok(events.indexOf('先查一下。')<events.indexOf('segment'))
    assert.ok(events.indexOf('segment')<events.indexOf('tool'))
    assert.ok(events.indexOf('tool')<events.indexOf('查到了。'))
  }finally{stop?.();native?.close();await ctx.fiber.dispose()}
})
