import { observeSessionOutput } from './session-output.mjs'

/** Own one DSH native Session and its voice output; closing does not cancel Host work. */
export function createAssistantOwner({ sessions, voice, onError, agentPreset }) {
  let closed = false
  let opening
  let reference
  let unobserve
  async function open() {
    if (closed) throw new Error('ASSISTANT_CLOSED')
    if (opening) return opening
    opening = (async () => {
      const sessionId = await sessions.create(agentPreset ? { agentPreset } : {})
      if (closed) throw new Error('ASSISTANT_CLOSED')
      const acquired = sessions.retain(sessionId, { source: 'voiceAssistant' })
      reference = acquired
      try {
        const binding = await acquired.ready
        if (closed) throw new Error('ASSISTANT_CLOSED')
        unobserve = observeSessionOutput({ eventSource: binding.eventSource, voice, onError })
        return binding
      } catch (error) {
        if (reference === acquired) { reference = undefined; acquired.release() }
        throw error
      }
    })()
    return opening
  }
  return {
    open,
    getSessionId() { return reference?.sessionId },
    /** An accepted result confirms admission only, not task completion. */
    async accept(text) {
      if (typeof text !== 'string' || !text.trim()) throw new Error('ASSISTANT_INPUT_INVALID')
      const binding = await open()
      if (closed) throw new Error('ASSISTANT_CLOSED')
      const submission = binding.session.beginSubmission({ mode: 'queue', text, attachments: [] })
      try {
        return await binding.session.prompt([{ type: 'text', text }], 'queue', undefined, submission.requestId)
      } catch (error) {
        submission.abandon()
        throw error
      }
    },
    close() {
      if (closed) return
      closed = true
      voice.suspend?.()
      unobserve?.()
      reference?.release()
      reference = undefined
      voice.dispose()
    },
  }
}
