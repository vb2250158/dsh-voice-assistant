import test from 'node:test'
import assert from 'node:assert/strict'
import {openDesktopVoiceServices} from './generated/services.js'
import {createVoiceInteraction} from './generated/voice-interaction.js'
import {projectCaptionPlayback,projectCaptionText} from './generated/caption-progress.js'
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
test('non-streaming desktop player advances actual multi-sentence caption positions',async()=>{
 const players=[];let caption=projectCaptionText({},{responseId:'reply',text:'先查。 查到了。'})
 const services=await openDesktopVoiceServices({signal:new AbortController().signal,settings:{},synthesize:async()=>new Uint8Array([1,2]),createAsr:()=>({createRound(){return{}},start(){},stop(){}}),
  openDevice:async()=>({close:async()=>{},createPlayer:async()=>{const events=new EventTarget(),player={events,play(){},stop:async()=>{},destroy:async()=>{}};players.push(player);return player}})})
 const voice=createVoiceInteraction({runtime:services.runtime,onInput(){},onEvent:event=>{if(event.type==='playback')caption=projectCaptionPlayback(caption,event.event)}})
 try{
  const response=voice.beginResponse({id:'reply'});response.append('先查。 查到了。');response.finish();await flush()
  assert.equal(players.length,1);assert.equal(caption.spokenEnd,0)
  players[0].events.dispatchEvent(Object.assign(new Event('progress'),{seconds:0}));assert.equal(caption.spokenEnd,3)
  players[0].events.dispatchEvent(new Event('ended'));await flush();assert.equal(players.length,2)
  players[1].events.dispatchEvent(Object.assign(new Event('progress'),{seconds:0}));assert.equal(caption.spokenEnd,8)
  voice.interruptSpeech('test');players[1].events.dispatchEvent(Object.assign(new Event('progress'),{seconds:1}));assert.equal(caption.spokenEnd,8)
 }finally{voice.dispose();await services.dispose()}
})
