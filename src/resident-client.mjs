import * as React from 'react'
import { Button, Input, Modal, IconMicrophoneOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { createAssistantPanel } from '@rabilink/assistant-runtime/ui'
import { subscribeConversation } from './subscribe-conversation.mjs'
const namespace='dsh-voice-assistant'
const deviceErrors = {
  DEVICE_ELECTRON_NOT_FOUND:'未找到 Electron。请在设置 → 进阶填写已安装的 electron.exe 绝对路径并保存；留空只查当前 DSH Home。',
  DEVICE_ELECTRON_PATH_INVALID:'Electron 路径无效。请在设置 → 进阶选择非空的 electron.exe 文件并填写绝对路径。',
  DEVICE_ELECTRON_UNREADABLE:'无法读取 Electron。请检查文件访问权限，或在设置 → 进阶指定可访问的 electron.exe。',
  DEVICE_ELECTRON_UNAVAILABLE:'无法检查 Electron 文件。请确认磁盘和文件可访问，再刷新设备。',
}
export const inject=['slots','layout','locale','sessions','uiConversation']
export function apply(ctx) {
  ctx.effect(()=>ctx.locale.register(namespace,{en:{title:'Voice assistant'},zh:{title:'语音助手'}}))
  const t=ctx.locale.bind(namespace)
  const request=async body=>{
    const response=await fetch('/api/voice-assistant',{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
      ...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})})
    const result=await response.json()
    if(!response.ok)throw Error(deviceErrors[result.error]||result.error||'ASSISTANT_CONNECTION_FAILED')
    return result
  }
  const adapter={read:()=>request(),command:request,subscribeConversation:(sessionId,onMessages,onError)=>
    subscribeConversation(ctx,sessionId,onMessages,onError)}
  const Panel=createAssistantPanel(React,{Button,Input,Modal})
  ctx.provide('dshAssistant',{open(){ctx.layout.selectPanel(namespace)}})
  ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:namespace,locale:namespace},()=>React.createElement(Panel,{adapter})))
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:namespace,order:30,locale:namespace,label:()=>t('title')},({size})=>React.createElement(IconMicrophoneOutlineRegular,{size})))
  if(new URL(location.href).searchParams.get('voice-assistant')==='1')ctx.layout.selectPanel(namespace)
}
