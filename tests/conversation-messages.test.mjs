import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conversationMessages } from '../src/conversation-messages.mjs'

test('native Chat order owns text, visibility and streaming-to-durable identity', () => {
  const user = { key:'u', kind:'user', visibility:'visible', data:{ content:[{type:'text',text:'hello'}] } }
  const reply = { key:'a', kind:'assistant-step', visibility:'visible', data:{status:'running',blocks:[{kind:'text',text:'partial'},{kind:'reasoning',text:'private'}]} }
  const hidden = { ...user, key:'hidden', visibility:'hidden' }
  const snapshot = {order:['u','hidden','a','a'],nodes:new Map([user,reply,hidden].map(n=>[n.key,n]))}
  assert.deepEqual(conversationMessages(snapshot,100), [{id:'u',role:'user',text:'hello'},{id:'a',role:'assistant',text:'partial'}])
  reply.data={status:'settled',blocks:[{kind:'text',text:'complete'}]}
  assert.deepEqual(conversationMessages(snapshot,1), [{id:'a',role:'assistant',text:'complete'}])
  snapshot.order=['u']
  assert.deepEqual(conversationMessages(snapshot,100), [{id:'u',role:'user',text:'hello'}])
})
