import * as React from 'react'
import { Button, Input, Modal, IconMicrophoneOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { createAssistantPanel } from '@rabilink/assistant-runtime/ui'
import { conversationMessages } from './conversation-messages.mjs'
const namespace='dsh-voice-assistant'
export const inject=['slots','layout','locale','sessions','uiConversation']
export function apply(ctx) {
  ctx.effect(()=>ctx.locale.register(namespace,{en:{title:'Voice assistant'},zh:{title:'语音助手'}}))
  const t=ctx.locale.bind(namespace)
  const request=async body=>{
    const response=await fetch('/api/voice-assistant',{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
      ...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})})
    const result=await response.json()
    if(!response.ok)throw Error(result.error||'ASSISTANT_CONNECTION_FAILED')
    return result
  }
  const adapter={read:()=>request(),command:request,subscribeConversation(sessionId,onMessages,onError){
    let closed=false,unsubscribe
    const ref=ctx.sessions.retain(sessionId,{source:'voiceAssistant'})
    void ref.ready.then(binding=>{
      if(closed)return
      const source=ctx.uiConversation.binding(binding).target('chat')
      const update=()=>{if(!closed)onMessages(conversationMessages(source.getSnapshot(),100))}
      unsubscribe=source.subscribe(update);update()
    }).catch(error=>{if(!closed)onError(error)})
    return ()=>{closed=true;unsubscribe?.();ref.release()}
  }}
  const Panel=createAssistantPanel(React,{Button,Input,Modal})
  ctx.provide('dshAssistant',{open(){ctx.layout.selectPanel(namespace)}})
  ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:namespace,locale:namespace},()=>React.createElement(Panel,{adapter})))
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:namespace,order:30,locale:namespace,label:()=>t('title')},({size})=>React.createElement(IconMicrophoneOutlineRegular,{size})))
  if(new URL(location.href).searchParams.get('voice-assistant')==='1')ctx.layout.selectPanel(namespace)
}
