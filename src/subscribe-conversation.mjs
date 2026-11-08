import { conversationMessages } from './conversation-messages.mjs'

/** Resolve an existing Session before retaining its Chat projection. */
export function subscribeConversation(ctx, sessionId, onMessages, onError) {
  let closed = false, reference, unsubscribe
  const release = () => { unsubscribe?.(); unsubscribe = undefined; reference?.release(); reference = undefined }
  void (async () => {
    try {
      const listed = await ctx.sessions.ensureListed(sessionId)
      if (closed) return
      if (!listed) throw Error('无法载入助手会话，请刷新页面重试。')
      reference = ctx.sessions.retain(sessionId, { source: 'voiceAssistant' })
      const binding = await reference.ready
      if (closed) return
      const source = ctx.uiConversation.binding(binding).target('chat')
      const update = () => { if (!closed) onMessages(conversationMessages(source.getSnapshot(), 100)) }
      unsubscribe = source.subscribe(update)
      update()
    } catch (error) {
      release()
      if (!closed) onError(error)
    }
  })()
  return () => { closed = true; release() }
}
