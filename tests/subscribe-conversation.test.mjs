import test from 'node:test'
import assert from 'node:assert/strict'
import { subscribeConversation } from '../src/subscribe-conversation.mjs'

const flush = () => new Promise(resolve => setImmediate(resolve))

test('lists an existing Session before retaining and releases the projection', async () => {
  const calls = [], received = [], errors = []
  let finishListing
  const pending = new Promise(resolve => { finishListing = resolve })
  const source = { getSnapshot: () => ({ order: [], nodes: new Map() }), subscribe() { calls.push('subscribe'); return () => calls.push('unsubscribe') } }
  const ctx = { sessions: { ensureListed(id) { calls.push('list:' + id); return pending }, retain(id) { calls.push('retain:' + id); return { ready: Promise.resolve('binding'), release() { calls.push('release') } } } }, uiConversation: { binding() { return { target: name => name==='chat'?source:{getSnapshot:()=>undefined,subscribe:()=>()=>{}} } } } }
  const dispose = subscribeConversation(ctx, 'existing', value => received.push(value), error => errors.push(error))
  assert.deepEqual(calls, ['list:existing'])
  finishListing(true); await flush()
  assert.deepEqual(calls, ['list:existing', 'retain:existing', 'subscribe'])
  assert.deepEqual(received, [[]]); assert.deepEqual(errors, [])
  dispose(); assert.deepEqual(calls.slice(-2), ['unsubscribe', 'release'])
})

test('closing while listing prevents retaining or reporting late failures', async () => {
  let complete, retained = false, errors = 0
  const ctx = { sessions: { ensureListed: () => new Promise(resolve => { complete = resolve }), retain() { retained = true } } }
  const dispose = subscribeConversation(ctx, 'existing', () => {}, () => { errors++ })
  dispose(); complete(true); await flush()
  assert.equal(retained, false); assert.equal(errors, 0)
})

test('missing or synchronously failing retain reports an error without crashing', async () => {
  for (const listed of [false, true]) {
    const errors = []
    const ctx = { sessions: { ensureListed: async () => listed, retain() { throw Error('retain failed') } } }
    const dispose = subscribeConversation(ctx, 'existing', () => {}, error => errors.push(error.message))
    await flush(); assert.equal(errors.length, 1); dispose()
  }
})
test('details index updates an existing native message and detaches on close',async()=>{
  let updateIndex,unsubscribed=false,index=new Set()
  const node={key:'key',kind:'user',visibility:'visible',data:{content:[{type:'text',text:'你好'}],source:{rpcId:'request-1234'}}}
  const source={getSnapshot:()=>({order:['key'],nodes:new Map([['key',node]])}),subscribe:()=>()=>{}}
  const ctx={sessions:{ensureListed:async()=>true,retain:()=>({ready:Promise.resolve('binding'),release(){}})},uiConversation:{binding:()=>({target:name=>name==='chat'?source:{getSnapshot:()=>undefined,subscribe:()=>()=>{}}})}}
  const received=[]
  const stop=subscribeConversation(ctx,'existing',value=>received.push(value),error=>{throw error},undefined,()=>index,fn=>{updateIndex=fn;return()=>{unsubscribed=true}})
  await flush();assert.equal(received.at(-1)[0].hasDetails,undefined)
  index=new Set(['u:request-1234']);updateIndex()
  assert.equal(received.at(-1)[0].hasDetails,true)
  stop();assert.equal(unsubscribed,true)
})
test('native trajectory updates details availability and releases both subscriptions',async()=>{
 let changed,off=0,lastTrajectory
 const node={key:'key',kind:'assistant-step',visibility:'visible',data:{turn:2,step:1,blocks:[{kind:'text',text:'回答'}]}}
 const chat={getSnapshot:()=>({order:['key'],nodes:new Map([['key',node]])}),subscribe:()=>()=>off++}
 const trajectory={getSnapshot:()=>({requests:[],eventNodes:[],runningCalls:[]}),subscribe:fn=>{changed=fn;return()=>off++}}
 const ctx={sessions:{ensureListed:async()=>true,retain:()=>({ready:Promise.resolve('binding'),release(){}})},uiConversation:{binding:()=>({target:name=>name==='chat'?chat:trajectory})}}
 const received=[]
 const stop=subscribeConversation(ctx,'session',value=>received.push(value),error=>{throw error},undefined,undefined,undefined,value=>{lastTrajectory=value})
 await flush();assert.equal(received.at(-1)[0].hasDetails,true);assert.ok(lastTrajectory)
 changed();assert.equal(received.length,2);stop();assert.equal(off,2);assert.equal(lastTrajectory,undefined)
})

test('an exclusive voice reference activates native Chat for history and streamed replies', async () => {
  let retained = false
  let notify
  let text = '第一句'
  const chat = {
    getSnapshot() {
      return retained ? {
        order: ['user', 'reply'],
        nodes: new Map([
          ['user', { key: 'user', kind: 'user', visibility: 'visible', data: { content: [{ type: 'text', text: '你好' }] } }],
          ['reply', { key: 'reply', kind: 'assistant-step', visibility: 'visible', data: { turn: 2, step: 1, blocks: [{ kind: 'text', text }] } }],
        ]),
      } : { order: [], nodes: new Map() }
    },
    subscribe(listener) { notify = listener; return () => { notify = undefined } },
  }
  const ctx = {
    sessions: {
      ensureListed: async () => true,
      retain(_id, options) {
        retained = options.facets?.conversation === true
        return { ready: Promise.resolve('binding'), release() { retained = false } }
      },
    },
    uiConversation: {
      binding: () => ({ target: name => name === 'chat' ? chat : { getSnapshot: () => undefined, subscribe: () => () => {} } }),
    },
  }
  const received = []
  const stop = subscribeConversation(ctx, 'voice-session', messages => received.push(messages), error => { throw error })
  await flush()
  assert.equal(received.at(-1).find(item => item.id === 'a:2:1')?.text, '第一句')
  text += '还有后半句'
  notify()
  assert.deepEqual(received.at(-1).map(item => [item.role, item.text]), [['user', '你好'], ['assistant', '第一句还有后半句']])
  stop()
  assert.equal(retained, false)
  assert.equal(notify, undefined)
})
