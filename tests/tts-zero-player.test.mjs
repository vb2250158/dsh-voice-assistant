import test from 'node:test'
import assert from 'node:assert/strict'
import {createStreamPlayers} from '../runtime/stream-players.mjs'
test('zero-audio reply ends once and does not block the next reply',async()=>{
 const sources=[],events=[],timers=new Map();let next=0
 class AudioContext{
  currentTime=0
  async suspend(){} async resume(){} async close(){}
  createBuffer(_channels,length){return{getChannelData:()=>new Float32Array(length)}}
  createBufferSource(){const item={connect(){},disconnect(){},start(){},stop(){},onended:null};sources.push(item);return item}
 }
 const players=createStreamPlayers({AudioContext,send:event=>events.push(event),maxQueuedSeconds:1,clock:{setInterval(fn){timers.set(++next,fn);return next},clearInterval(id){timers.delete(id)}}})
 await players.create({id:'symbols',sampleRate:8000});await players.play('symbols');players.finish('symbols');players.finish('symbols')
 assert.equal(events.filter(item=>item.id==='symbols'&&item.event==='player.ended').length,1);assert.equal(timers.size,0)
 await players.dispose('symbols');await players.create({id:'next',sampleRate:8000});await players.play('next')
 await players.append('next',new Uint8Array(1600));players.finish('next');sources[0].onended()
 assert.equal(events.filter(item=>item.id==='next'&&item.event==='player.ended').length,1)
 await players.dispose('next');assert.equal(timers.size,0)
})
