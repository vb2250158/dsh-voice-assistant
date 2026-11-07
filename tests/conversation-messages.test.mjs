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

test('native terminal notices preserve projection order, visibility and failure details', () => {
  const nodes=[{key:'u',kind:'user',visibility:'visible',data:{content:[{type:'text',text:'hello'}]}},
    {key:'e',kind:'turn-error',visibility:'visible',data:{code:'MISSING_CREDENTIAL',message:'',turn:1,step:1}},
    {key:'h',kind:'turn-error',visibility:'hidden',data:{code:'MISSING_CREDENTIAL',message:''}}]
  const snapshot={order:['u','e','e','h'],nodes:new Map(nodes.map(node=>[node.key,node]))}
  const projected=conversationMessages(snapshot,100)
  assert.equal(projected.length,2);assert.equal(projected[1].notice,true)
  assert.match(projected[1].text,/DSH 的模型设置/)
  nodes[1].data={code:'INTERRUPTED',message:''}
  assert.match(conversationMessages(snapshot,1)[0].text,/本轮任务已停止/)
  nodes[1].data={code:'OTHER_ERROR',message:'sanitized provider explanation'}
  assert.match(conversationMessages(snapshot,1)[0].text,/sanitized provider explanation/)
  nodes[1].data={code:'toString',message:''}
  assert.equal(typeof conversationMessages(snapshot,1)[0].text,'string')
})
