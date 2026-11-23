import * as React from 'react'
import { Button, Input, IconMicrophoneOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { createAssistantPanel } from '@rabilink/assistant-runtime/ui'
import { createSpeechExpressionDecoder } from '@rabilink/assistant-runtime/voice'
import { subscribeConversation } from './subscribe-conversation.mjs'
import { projectCanvasHistory } from './canvas-history.mjs'
import { projectNativeActivity, projectNativeExecution } from './native-execution-projection.mjs'
const namespace='dsh-voice-assistant'
const deviceErrors = {
  DEVICE_ELECTRON_NOT_FOUND:'未找到 Electron。请在设置 → 进阶填写已安装的 electron.exe 绝对路径并保存；留空只查当前 DSH Home。',
  DEVICE_ELECTRON_PATH_INVALID:'Electron 路径无效。请在设置 → 进阶选择非空的 electron.exe 文件并填写绝对路径。',
  DEVICE_ELECTRON_UNREADABLE:'无法读取 Electron。请检查文件访问权限，或在设置 → 进阶指定可访问的 electron.exe。',
  DEVICE_ELECTRON_UNAVAILABLE:'无法检查 Electron 文件。请确认磁盘和文件可访问，再刷新设备。',
  ASSISTANT_WAKE_SERVICE_UNAVAILABLE:'当前 DSH 没有可用的本机唤醒服务。',
  ASSISTANT_WAKE_ALIASES_REQUIRED:'至少填写一个唤醒词。',
  ASSISTANT_WAKE_ALIASES_INVALID:'最多可填 64 个唤醒词，每个最多 64 个字。',
}
const wakePhaseLabel = {
  starting:'正在连接本机唤醒服务', armed:'等待唤醒词', active:'实时语音进行中',
  'local-fallback':'正在使用本机转写', waiting:'正在重新连接本机唤醒服务', unavailable:'本机唤醒不可用',
}
function KeywordWakeSettings({ state, settingsTab, command, dirty }) {
  const enabled = state?.settings?.keywordWakeEnabled ?? false
  const aliases = state?.settings?.keywordWakeAliases ?? ''
  const [mode, setMode] = React.useState(enabled ? 'keyword' : 'manual')
  const [text, setText] = React.useState(aliases)
  React.useEffect(() => { setMode(enabled ? 'keyword' : 'manual'); setText(aliases) }, [enabled, aliases])
  if (settingsTab !== 'devices' || !state) return null
  const h = React.createElement
  const available = state.capabilities?.keywordWake === true
  const wake = state.keywordWake
  const changed = (mode === 'keyword') !== enabled || text !== aliases
  return h('fieldset', null, h('legend', null, '启动语音'),
    h('label', null, '启动方式', h('select', { value: mode, disabled: !available && !enabled, 'aria-label':'语音启动方式', onChange:event => setMode(event.target.value) },
      h('option', { value:'manual' }, '手动开始'), h('option', { value:'keyword', disabled:!available }, '关键词唤醒'))),
    mode === 'keyword' && h('label', null, '唤醒词', h(Input, { value:text, placeholder:'例如：小助手、你好助手', onChange:event => setText(event.target.value) })),
    mode === 'keyword' && h('p', null, '多个唤醒词用逗号分隔。唤醒前只在本机转写。'),
    !available && h('p', { role:'status' }, '本机唤醒服务尚未配置，可以手动开始实时语音。'),
    available && wakePhaseLabel[wake?.phase] && h('p', { role:'status' }, wakePhaseLabel[wake.phase], wake.error ? ' · ' + (deviceErrors[wake.error] || '请检查唤醒配置') : ''),
    (available || enabled) && h(Button, { disabled:dirty || !changed || mode === 'keyword' && !text.trim(), onClick:() => command({
      action:'settings', patch:{ keywordWakeEnabled:mode === 'keyword', keywordWakeAliases:text },
    }, '唤醒设置已保存。') }, '保存唤醒设置'))
}
export const inject=['slots','layout','locale','sessions','uiConversation']
export function apply(ctx) {
  ctx.effect(()=>ctx.locale.register(namespace,{en:{title:'Voice assistant',back:'Back'},zh:{title:'语音助手',back:'返回'}}))
  const t=ctx.locale.bind(namespace)
  const request=async body=>{
    const response=await fetch('/api/voice-assistant',{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
      ...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})})
    const result=await response.json()
    if(!response.ok)throw Error(deviceErrors[result.error]||result.error||'ASSISTANT_CONNECTION_FAILED')
    return result
  }
  let index = new Set(), indexKey = '', trajectory, trajectorySession, activeSubscription, currentSession, visibleMessages = new Map()
  const indexListeners = new Set()
  const adapter={read:async()=>{
    const state=await request(), next=Array.isArray(state.messageDetailsIndex)?state.messageDetailsIndex:[]
    const key=JSON.stringify(next)
    if(key!==indexKey){indexKey=key;index=new Set(next);for(const listener of indexListeners)listener()}
    currentSession=state.sessionId
    const activity=projectNativeActivity(trajectorySession===currentSession?trajectory:undefined)
    return activity?{...state,activity}:state
  },command:async body=>{
    if(body?.action!=='message-details')return request(body)
    const execution=projectNativeExecution(trajectorySession===currentSession?trajectory:undefined,body.messageId)
    let details
    try{details=await request(body)}catch(error){
      if(error.message!=='ASSISTANT_MESSAGE_DETAILS_UNAVAILABLE'||!execution)throw error
      const message=visibleMessages.get(body.messageId)
      if(!message)throw error
      details={message:{id:message.id,role:message.role,text:message.text}}
    }
    return execution?{...details,execution}:details
  },subscribeConversation:(sessionId,onMessages,onError)=>{
    const subscription={}
    activeSubscription=subscription; trajectory=undefined; trajectorySession=sessionId; visibleMessages.clear()
    const stop=subscribeConversation(ctx,sessionId,value=>{if(activeSubscription!==subscription)return;visibleMessages=new Map(value.map(item=>[item.id,item]));onMessages(value)},error=>{if(activeSubscription===subscription)onError(error)},createSpeechExpressionDecoder,()=>index,listener=>{indexListeners.add(listener);return()=>indexListeners.delete(listener)},value=>{if(activeSubscription!==subscription)return;trajectory=value;if(!value)visibleMessages.clear()},projectCanvasHistory)
    return ()=>{stop();if(activeSubscription===subscription){activeSubscription=undefined;trajectory=undefined;trajectorySession=undefined;visibleMessages.clear()}}
  }}
  const SettingsPage=({open,title,onClose,children})=>open?React.createElement('div',null,
    React.createElement('header',{style:{display:'flex',alignItems:'center',gap:12}},React.createElement(Button,{onClick:onClose},t('back')),React.createElement('h2',null,title)),children):null
  const Panel=createAssistantPanel(React,{Button,Input,Modal:SettingsPage,HostSettings:KeywordWakeSettings,settingsPresentation:'page'})
  ctx.provide('dshAssistant',{open(){ctx.layout.selectPanel(namespace)}})
  ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:namespace,locale:namespace},()=>React.createElement(Panel,{adapter})))
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:namespace,order:30,locale:namespace,label:()=>t('title')},({size})=>React.createElement(IconMicrophoneOutlineRegular,{size})))
  if(new URL(location.href).searchParams.get('voice-assistant')==='1')ctx.layout.selectPanel(namespace)
}
