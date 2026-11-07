/** Render only public Chat nodes, in the order supplied by the native projection. */
export function conversationMessages(snapshot, limit) {
  if (!snapshot) return []
  const seen = new Set(), messages = []
  for (const key of snapshot.order) {
    if (seen.has(key)) continue
    seen.add(key)
    const node = snapshot.nodes.get(key)
    if (node?.visibility !== 'visible') continue
    let role, text
    if (node.kind === 'assistant-step') {
      role = 'assistant'
      text = node.data.blocks.filter(block => block.kind === 'text').map(block => block.text).join('')
    } else if (node.kind === 'user' || node.kind === 'steering') {
      role = 'user'
      text = node.data.content.filter(block => block.type === 'text').map(block => block.text).join('')
    } else continue
    if (text) messages.push({ id: node.key, role, text })
  }
  return messages.slice(-limit)
}
