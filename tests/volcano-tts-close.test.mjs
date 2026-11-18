import test from 'node:test'
import assert from 'node:assert/strict'
import {openVolcanoTts} from './generated/volcano-tts.js'
import {decodeFrame} from './generated/volcano-codec.js'
const integer=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b}
const response=(event,id,payload=Buffer.from('{}'))=>Buffer.concat([Buffer.from([0x11,0x94,0x10,0]),integer(event),integer(Buffer.byteLength(id)),Buffer.from(id),integer(payload.length),payload])
test('zero-audio completion and concurrent close observe the pending connection acknowledgement',async()=>{
 let receive,closed=0
 const stream=await openVolcanoTts({endpoint:'wss://example.com',voice:'fixture',onAudio:()=>assert.fail('zero audio fixture'),connect:async({onMessage})=>{
  receive=onMessage;return{close:async()=>{closed++},send:async bytes=>{
   const msg=decodeFrame(bytes,{tts:true})
   if(msg.event===2){await new Promise(resolve=>setTimeout(resolve,25));return}
   const expected=({1:50,100:150,102:152})[msg.event]
   if(expected)queueMicrotask(()=>void receive(response(expected,msg.id||'connection')))
  }}
 }})
 await stream.append('***');await stream.finish();assert.equal((await stream.finished).duration,0);await stream.close()
 await new Promise(resolve=>setTimeout(resolve,40));assert.equal(closed,1)
})
