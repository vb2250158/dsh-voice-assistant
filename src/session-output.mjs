/** Project new native Session text into shared voice response tokens. */
export function observeSessionOutput({ eventSource, voice, onError }) {
  let closed = false
  let revision = eventSource.getSnapshot().revision
  const responses = new Map()
  let foreground
  const finish = (key, speak = true) => {
    const response = responses.get(key)
    if (response) { response.token.finish({ speak }); responses.delete(key) }
  }
  const update = () => {
    if (closed) return
    const snapshot = eventSource.getSnapshot()
    if (snapshot.revision === revision) return
    revision = snapshot.revision
    const change = snapshot.change
    if (change.kind === 'settle-assistant') {
      const key = String(change.attemptId)
      const event = change.entry?.event
      const response = responses.get(key)
      const confirmed = response?.confirmed === true || (event?.type === 'assistant/message' && event.data.interrupted !== true)
      if (response && foreground === key && !confirmed) {
        voice.interruptSpeech('assistant-output-unconfirmed')
      }
      finish(key, confirmed)
      return
    }
    if (change.kind !== 'append') return
    for (const entry of change.entries) {
      if (entry.type === 'event' && entry.event.type === 'assistant/message' && entry.event.data.interrupted !== true) {
        for (const response of responses.values()) {
          if (response.turn === entry.event.data.turn && response.step === entry.event.data.step) response.confirmed = true
        }
        continue
      }
      if (entry.type !== 'transient' || entry.event.type !== 'assistant/live-chunk') continue
      const { attemptId, turn, step, chunk } = entry.event.data
      if (chunk.type !== 'text-delta' || typeof chunk.text !== 'string' || !chunk.text) continue
      const key = String(attemptId)
      if (!responses.has(key)) { foreground = key; responses.set(key, { token:voice.beginResponse({ id: key }), turn, step, confirmed:false }) }
      responses.get(key)?.token.append(chunk.text)
    }
  }
  const unsubscribe = eventSource.subscribe(() => { try { update() } catch (error) { onError(error) } })
  return () => {
    if (closed) return
    closed = true
    unsubscribe()
    for (const response of responses.values()) response.token.finish({ speak:false })
    responses.clear()
  }
}
