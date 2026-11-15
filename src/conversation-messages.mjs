/** Render only public Chat nodes, in the order supplied by the native projection. */
export function conversationMessages(snapshot, limit, createDecoder, detailIndex = new Set()) {
  if (!snapshot) return []
  const seen = new Set(), messages = []
  for (const key of snapshot.order) {
    if (seen.has(key)) continue
    seen.add(key)
    const node = snapshot.nodes.get(key)
    if (node?.visibility !== 'visible') continue
    let role, text, notice = false, diagnosticId
    if (node.kind === 'assistant-step') {
      role = 'assistant'
      if (Number.isSafeInteger(node.data.turn) && Number.isSafeInteger(node.data.step)) diagnosticId = `a:${node.data.turn}:${node.data.step}`
      text = node.data.blocks.filter(block => block.kind === 'text').map(block => block.text).join('')
      if (createDecoder) { const decoder = createDecoder(); decoder.push(text); text = decoder.finish().text }
    } else if (node.kind === 'turn-error') {
      role = 'assistant'; notice = true
      const code = node.data.code
      const known = {
        MISSING_CREDENTIAL: '当前对话模型缺少凭据。请在 DSH 的模型设置中配置该模型，再手动发送消息。',
        ACCOUNT_SIGNED_OUT: '当前模型账号已退出登录。请在 DSH 中重新登录，再手动发送消息。',
        INTERRUPTED: '本轮任务已停止；已生成的内容仍保留。',
      }
      const message = typeof node.data.message === 'string' ? node.data.message.slice(0,2000) : ''
      text = (Object.hasOwn(known, code) ? known[code] : undefined) || ('本轮处理失败' + (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,100}$/.test(code) ? '（' + code + '）' : '') + (message ? '：' + message : '。请在原生会话查看详情。'))
    } else if (node.kind === 'user' || node.kind === 'steering') {
      role = 'user'
      if (typeof node.data.source?.rpcId === 'string') diagnosticId = `u:${node.data.source.rpcId}`
      text = node.data.content.filter(block => block.type === 'text').map(block => block.text).join('')
    } else continue
    if (text) messages.push({ id: diagnosticId ?? node.key, role, text, ...(notice ? {notice:true} : {}), ...(diagnosticId && detailIndex.has(diagnosticId) ? { hasDetails:true, ...(role === 'user' ? {source:'speech'} : {}) } : {}) })
  }
  return messages.slice(-limit)
}
