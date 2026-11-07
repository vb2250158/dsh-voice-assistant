import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeSession } from '../src/native-session.mjs'
function fixture(saved={}) {
  const listeners=new Map(),sections=new Map(),hooks=new Map(),calls=[];let config={persona:'first'}
  const agent={id:saved.sessionId,ctx:{systemPrompt:{async assemble(){
    const initial={sections:[{name:'deployment:persona-prefix',text:'preset persona'},{name:'tool:existing',text:'native tools'}],contexts:[],variables:{}}
    return hooks.get('system-prompt/assemble')?.(initial,{},async()=>initial)??initial
  }},on(name,fn){hooks.set(name,fn);return()=>hooks.delete(name)}}}
  const ctx={on(name,fn){listeners.set(name,fn);return()=>listeners.delete(name)},sessionController:{
    async create(args){calls.push(args);agent.id=args.sessionId;return {sessionId:args.sessionId}},
    async resolveAgent(id){assert.equal(id,agent.id);return {agent}},
    async prompt(args,signal){calls.push({prompt:args,signal});return {accepted:true}},
  }}
  const binding={get:()=>saved,async set(value){saved=value}}
  const create=options=>createNativeSession(ctx,{settings:()=>config,binding,...options})
  const session=create()
  return {session,create,calls,sections,hooks,listeners,binding,agent,setConfig:value=>{config=value}}
}
test('new Session uses native default preset and restores the same durable identity',async()=>{
  const f=fixture();const [id,again]=await Promise.all([f.session.open(),f.session.open()]);assert.equal(id,again)
  assert.equal(f.calls.length,1);assert.equal('agentPreset' in f.calls[0],false)
  const saved=f.binding.get();f.session.close();const next=fixture(saved);await next.session.open();assert.equal(next.calls.length,0)
  next.session.close()
})
test('persona updates at a new native turn, keeps tool steps in the original persona',async()=>{
  const f=fixture();await f.session.open();const hook=f.hooks.get('agent/request-context');let next=0
  await hook({agent:f.agent,turn:1},async()=>{next++})
  f.setConfig({persona:'second'})
  await hook({agent:f.agent,turn:1},async()=>{next++})
  assert.equal((await f.agent.ctx.systemPrompt.assemble()).sections[0].text,'first')
  await hook({agent:f.agent,turn:2},async()=>{next++})
  assert.equal((await f.agent.ctx.systemPrompt.assemble()).sections[0].text,'second');assert.equal(next,3)
  assert.equal((await f.agent.ctx.systemPrompt.assemble()).sections[1].text,'native tools')
  f.session.close();assert.equal(f.hooks.size,0)
})
test('failed native tool attachment rolls back scoped hooks and retries the installation',async()=>{
  const f=fixture({sessionId:'saved'});f.session.close();let installs=0,removed=0
  const session=f.create({installTools(){if(++installs===1)throw Error('TOOL_ATTACH_FAILED');return()=>{removed++}}})
  await assert.rejects(session.open(),/TOOL_ATTACH_FAILED/);assert.equal(f.hooks.size,0)
  await session.open();assert.equal(installs,2);assert.equal(f.hooks.size,2)
  session.close();assert.equal(removed,1);assert.equal(f.hooks.size,0)
})
test('disposing voice-facing binding does not cancel admitted native work',async()=>{
  const f=fixture();await f.session.submit('do work','request-1234');const admitted=f.calls.at(-1)
  f.session.close();assert.equal(admitted.signal.aborted,false);assert.equal(admitted.prompt.mode,'queue')
  assert.equal(f.listeners.size,0)
})
test('close during prompt assembly rejects attachment and releases each hook once',async()=>{
  const f=fixture({sessionId:'saved'});f.session.close();let resolveAssembly,removed=0
  f.agent.ctx.systemPrompt.assemble=()=>new Promise(resolve=>{resolveAssembly=resolve})
  const session=f.create({installTools:()=>()=>{removed++}})
  const pending=session.open()
  while(!resolveAssembly) await new Promise(resolve=>setImmediate(resolve))
  session.close();resolveAssembly({sections:[{name:'voice-assistant:persona',text:'first'}]})
  await assert.rejects(pending,/ASSISTANT_CLOSED/)
  assert.equal(removed,1);assert.equal(f.hooks.size,0);assert.equal(f.listeners.size,0)
})
