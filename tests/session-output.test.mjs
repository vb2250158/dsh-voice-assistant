import { test } from 'node:test'
import assert from 'node:assert/strict'
import { observeSessionOutput } from '../src/session-output.mjs'

test('seals the current speech segment on native tool call without ending the response', () => {
  let snapshot={revision:0},notify
  const calls=[],source={getSnapshot:()=>snapshot,subscribe(fn){notify=fn;return()=>{}}}
  const voice={beginResponse:({id})=>({append:text=>calls.push([id,'text',text]),finishSpeechSegment:()=>calls.push([id,'segment']),finish:()=>calls.push([id,'finish'])})}
  const stop=observeSessionOutput({eventSource:source,voice,onError:error=>{throw error}})
  const send=(revision,attemptId,chunk)=>{snapshot={revision,change:{kind:'append',entries:[{type:'transient',event:{type:'assistant/live-chunk',data:{attemptId,turn:1,step:1,chunk}}}]}};notify()}
  send(1,'a',{type:'text-delta',text:'先查一下。'})
  send(2,'a',{type:'block-start',blockType:'tool-call'})
  send(3,'a',{type:'text-delta',text:'继续说。'})
  assert.deepEqual(calls,[['a','text','先查一下。'],['a','segment'],['a','text','继续说。']])
  stop()
})

test('tool events without a matching live response do not seal a different response', () => {
  let snapshot={revision:0},notify,segments=0
  const source={getSnapshot:()=>snapshot,subscribe(fn){notify=fn;return()=>{}}}
  const stop=observeSessionOutput({eventSource:source,voice:{beginResponse:()=>({append(){},finishSpeechSegment(){segments++},finish(){}})},onError:error=>{throw error}})
  snapshot={revision:1,change:{kind:'append',entries:[{type:'transient',event:{type:'assistant/live-chunk',data:{attemptId:'a',chunk:{type:'text-delta',text:'说话'}}}}]}};notify()
  snapshot={revision:2,change:{kind:'append',entries:[{type:'transient',event:{type:'assistant/live-chunk',data:{attemptId:'b',chunk:{type:'block-start',blockType:'tool-call'}}}}]}};notify()
  assert.equal(segments,0);stop()
})

test('projects only new live text once and retires its owner at durable settlement', () => {
  let snapshot = { revision: 0, change: { kind: 'replace', entries: [] } }, notify
  const source = { getSnapshot: () => snapshot, subscribe: fn => { notify = fn; return () => { notify = null } } }
  const calls = []
  const voice = { beginResponse: ({ id }) => ({ append: text => calls.push([id, text]), finish: () => calls.push([id, 'finished']) }) }
  const stop = observeSessionOutput({ eventSource: source, voice, onError: error => { throw error } })
  const delta = { type: 'transient', event: { type: 'assistant/live-chunk', data: { attemptId: 'a', chunk: { type: 'text-delta', text: 'hello' } } } }
  snapshot = { revision: 1, change: { kind: 'append', entries: [delta] } }; notify(); notify()
  snapshot = { revision: 2, change: { kind: 'settle-assistant', attemptId: 'a', entry: { event: { type: 'assistant/message', data: {} } } } }; notify()
  assert.deepEqual(calls, [['a', 'hello'], ['a', 'finished']])
  stop(); assert.equal(notify, null)
})

test('a durable successful message followed by an empty retirement is not suppressed', () => {
  let snapshot = { revision: 0 }, notify
  const source = { getSnapshot: () => snapshot, subscribe: fn => { notify = fn; return () => {} } }
  const calls = []
  const voice = { beginResponse: () => ({ append() {}, finish() { calls.push('finish') } }), interruptSpeech() { calls.push('interrupt') } }
  const stop = observeSessionOutput({ eventSource: source, voice, onError: error => { throw error } })
  snapshot = { revision: 1, change: { kind: 'append', entries: [{ type:'transient', event:{ type:'assistant/live-chunk',
    data:{ attemptId:'a', turn:2, step:3, chunk:{ type:'text-delta', text:'hello' } } } }] } }; notify()
  snapshot = { revision: 2, change: { kind:'append', entries:[{ type:'event', event:{ type:'assistant/message', data:{ turn:2, step:3 } } }] } }; notify()
  snapshot = { revision: 3, change: { kind:'settle-assistant', attemptId:'a' } }; notify()
  assert.deepEqual(calls, ['finish'])
  stop()
})

test('failed output is suppressed without interrupting a newer response', () => {
  let snapshot = { revision: 0 }, notify
  const source = { getSnapshot: () => snapshot, subscribe: fn => { notify = fn; return () => {} } }
  const calls = []
  const voice = { beginResponse: ({ id }) => ({ append() {}, finish(options) { calls.push(['finish', id, options.speak]) } }),
    interruptSpeech: reason => calls.push(['interrupt', reason]) }
  const stop = observeSessionOutput({ eventSource: source, voice, onError: error => { throw error } })
  const entry = attemptId => ({ type: 'transient', event: { type: 'assistant/live-chunk', data: { attemptId, chunk: { type: 'text-delta', text: 'text' } } } })
  snapshot = { revision: 1, change: { kind: 'append', entries: [entry('old'), entry('new')] } }; notify()
  snapshot = { revision: 2, change: { kind: 'settle-assistant', attemptId: 'old', entry: { event: { type: 'assistant/attempt', data: {} } } } }; notify()
  snapshot = { revision: 3, change: { kind: 'settle-assistant', attemptId: 'new', entry: { event: { type: 'assistant/attempt', data: {} } } } }; notify()
  assert.deepEqual(calls, [['finish', 'old', false], ['interrupt', 'assistant-output-unconfirmed'], ['finish', 'new', false]])
  stop()
})

test('late source notifications after close cannot start playback', () => {
  let snapshot = { revision: 0 }, notify, started = 0
  const source = { getSnapshot: () => snapshot, subscribe: fn => { notify = fn; return () => {} } }
  const stop = observeSessionOutput({ eventSource: source, voice: { beginResponse() { started++ } }, onError: error => { throw error } })
  stop()
  snapshot = { revision: 1, change: { kind: 'append', entries: [{ type:'transient', event:{ type:'assistant/live-chunk',
    data:{ attemptId:'late', chunk:{ type:'text-delta', text:'late' } } } }] } }
  notify()
  assert.equal(started, 0)
})
test('text presentation continues when the voice owner is stopped', () => {
  let snapshot = { revision: 0 }, notify
  const frames = [], source = { getSnapshot:()=>snapshot, subscribe(fn){notify=fn;return()=>{notify=undefined}} }
  const stop=observeSessionOutput({eventSource:source,voice:{beginResponse:()=>null},onText:frame=>frames.push(frame),onError:error=>{throw error}})
  for(const [i,text] of ['hello',' world'].entries()) {
    snapshot={revision:i+1,change:{kind:'append',entries:[{type:'transient',event:{type:'assistant/live-chunk',data:{attemptId:'a',chunk:{type:'text-delta',text}}}}]}}
    notify()
  }
  assert.deepEqual(frames,[{responseId:'a',text:'hello'},{responseId:'a',text:'hello world'}]);stop()
})
test('applies decoded expression before speech and exposes only decoded prose',()=>{
  let snapshot={revision:0},notify
  const calls=[],frames=[]
  const source={getSnapshot:()=>snapshot,subscribe(fn){notify=fn;return()=>{}}}
  const voice={beginResponse:()=>({setSpeech:value=>calls.push(['speech',value]),append:value=>calls.push(['append',value]),finish:()=>calls.push(['finish'])})}
  const decoder=()=>({push:()=>({expression:{rate:1.1},delta:'正文'}),finish:()=>({delta:''})})
  const stop=observeSessionOutput({eventSource:source,voice,createDecoder:decoder,onText:value=>frames.push(value),onError:error=>{throw error}})
  snapshot={revision:1,change:{kind:'append',entries:[{type:'transient',event:{type:'assistant/live-chunk',data:{attemptId:'a',turn:1,chunk:{type:'text-delta',text:'<voice rate="1.1"/>正文'}}}}]}};notify()
  assert.deepEqual(calls,[['speech',{expression:{rate:1.1}}],['append','正文']])
  assert.equal(frames[0].text,'正文');stop()
})
