import { conversationMessages } from './conversation-messages.mjs'
import { projectNativeActivity } from './native-execution-projection.mjs'

/** Resolve an existing Session before retaining its Chat projection. */
export function subscribeConversation(ctx, sessionId, onMessages, onError, createDecoder, getIndex = () => new Set(), subscribeIndex = () => () => {}, onTrajectory = () => {}, projectCanvasHistory = () => new Map()) {
  let closed = false, reference, unsubscribe, unsubscribeIndex, unsubscribeTrajectory
  const release = () => { unsubscribe?.(); unsubscribe = undefined; unsubscribeIndex?.(); unsubscribeIndex = undefined; unsubscribeTrajectory?.(); unsubscribeTrajectory = undefined; onTrajectory(undefined); reference?.release(); reference = undefined }
  void (async () => {
    try {
      const listed = await ctx.sessions.ensureListed(sessionId)
      if (closed) return
      if (!listed) throw Error('无法载入助手会话，请刷新页面重试。')
      reference = ctx.sessions.retain(sessionId, { source: 'voiceAssistant', facets: { conversation: true } })
      const binding = await reference.ready
      if (closed) return
      const conversation = ctx.uiConversation.binding(binding), source = conversation.target('chat'), trajectory = conversation.target('trajectory')
      const update = () => { if (!closed) {
        const view=trajectory.getSnapshot(), activity=projectNativeActivity(view)
        onTrajectory(view)
        const messages=conversationMessages(source.getSnapshot(), 100, createDecoder, getIndex(), projectCanvasHistory(view)).map(item=>view&&item.role==='assistant'&&/^a:\d+:\d+$/.test(item.id)?{...item,hasDetails:true}:item)
        if(activity&&!messages.some(item=>item.id===activity.responseId))messages.push({id:activity.responseId,role:'assistant',text:'',hasDetails:true})
        onMessages(messages)
      } }
      unsubscribe = source.subscribe(update)
      unsubscribeTrajectory = trajectory.subscribe(update)
      unsubscribeIndex = subscribeIndex(update)
      update()
    } catch (error) {
      release()
      if (!closed) onError(error)
    }
  })()
  return () => { closed = true; release() }
}
