import test from 'node:test'
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import {optionalPetPresenter} from '../src/optional-pet.mjs'
function fixture(){
  let connect,release,disposed=0;const frames=[]
  const pet=optionalPetPresenter({inject(names,fn){assert.deepEqual(names,['petAssistantPresenter']);connect=fn}})
  const service={protocol:1,packageVersion:'fixture',listPets:()=>[{id:'fish',name:'Fish'}],attach:()=>({
    async present(value){frames.push(value)},async clear(){frames.push({clear:true})},async dispose(){disposed++},
  })}
  return {pet,frames,disposed:()=>disposed,connect:()=>connect({petAssistantPresenter:service,effect(fn){release=fn()}}),release:()=>release()}
}
test('optional pet absence is harmless, text coalesces and animation is not restarted for every token',async()=>{
  const f=fixture();assert.equal(f.pet.state().available,false);f.connect();assert.equal(f.pet.state().available,true)
  const config={petEnabled:true,petId:'fish',petBubbles:true,petAnimation:true}
  f.pet.present(config,{responseId:'r1',text:'first'});f.pet.present(config,{responseId:'r1',text:'first full sentence'})
  await delay(400);assert.equal(f.frames.length,1);assert.equal(f.frames[0].text,'first full sentence');assert.equal(f.frames[0].animation,true)
  f.pet.present(config,{responseId:'r1',text:'next sentence'});await delay(400);assert.equal(f.frames[1].animation,false)
  f.pet.present({...config,petEnabled:false},{responseId:'r1',text:'next sentence'});await delay(400);assert.deepEqual(f.frames[2],{clear:true})
  await f.release();assert.equal(f.pet.state().available,false);assert.equal(f.disposed(),1)
  await f.pet.dispose();assert.equal(f.disposed(),1)
})
test('detaching with a pending frame prevents late pet output',async()=>{
  const f=fixture();f.connect();f.pet.present({petEnabled:true,petId:'fish',petBubbles:true,petAnimation:true},{responseId:'late',text:'late'})
  await f.release();await delay(400);assert.equal(f.frames.length,0);await f.pet.dispose()
})
