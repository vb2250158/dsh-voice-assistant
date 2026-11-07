import { createAiuiAssistantRuntime } from '@rabilink/assistant-runtime/aiui'
import { createVoiceInteraction } from '@rabilink/assistant-runtime/voice'
import { createAssistantOwner } from './assistant-owner.mjs'

/** One native Session and one voice owner shared by GUI and optional presenters. */
export function createDesktopAssistant({ sessions, asr, tts, agentPreset, onError, maxVisibleMessages }) {
  if (!Number.isSafeInteger(maxVisibleMessages) || maxVisibleMessages < 1 || maxVisibleMessages > 1000) throw new Error('ASSISTANT_MESSAGE_LIMIT_INVALID')
  const listeners = new Set()
  let closed = false
  let sequence = 0
  let state = { status: 'idle', transcript: '', response: '', pending: [], messages: [] }
  const publish = patch => {
    if (closed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const report = error => { if (!closed) { publish({ status: 'error' }); onError(error) } }
  const runtime = createAiuiAssistantRuntime({ asr, tts, onCleanupError: report })
  let owner
  const voice = createVoiceInteraction({ runtime, onError: report,
    onInput(input) {
      const item = { id: ++sequence, text: input.text, status: 'sending' }
      publish({ pending: [...state.pending, item], messages: [...state.messages, { id: `user:${item.id}`, role:'user', text:item.text }].slice(-maxVisibleMessages) })
      void owner.accept(input.text).then(result => {
        if (result?.ok === true) publish({ pending: state.pending.filter(value => value.id !== item.id) })
        else publish({ pending: state.pending.map(value => value.id === item.id ? { ...value, status: 'unconfirmed' } : value), status: 'unconfirmed' })
      }, error => {
        publish({ pending: state.pending.map(value => value.id === item.id ? { ...value, status: 'unconfirmed' } : value), status: 'unconfirmed' })
        if (!closed) onError(error)
      })
    },
    onEvent(event) {
      if (event.type === 'response') {
        const id = `assistant:${event.id}`
        const existing = state.messages.findIndex(item => item.id === id)
        const messages = [...state.messages]
        if (existing >= 0) messages[existing] = { id, role:'assistant', text:event.text }
        else if (event.text) messages.push({ id, role:'assistant', text:event.text })
        publish({ response:event.foreground ? event.text : state.response, messages:messages.slice(-maxVisibleMessages) })
      }
      else if (event.type === 'transcript') publish({ transcript: event.text })
      else if (event.type === 'listening' && event.event.type === 'listening') publish({ status: 'listening' })
      else if (event.type === 'listening' && event.event.type === 'ended' && event.event.reason !== 'end') publish({ status: 'stopped' })
      else if (event.type === 'playback' && (event.event.type === 'error' || event.event.type === 'unavailable')) publish({ status: 'playback-error' })
    },
  })
  owner = createAssistantOwner({ sessions, voice, agentPreset, onError: report })
  return {
    async open() { await owner.open(); publish({ status: 'ready' }) },
    getSessionId() { return owner.getSessionId() },
    activate() { return voice.activate() },
    send(text) { return voice.submitText(text) },
    suspend() { voice.pauseListening(); voice.interruptSpeech('view-hidden'); publish({ status: 'stopped' }) },
    getSnapshot() { return state },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    close() { if (closed) return; owner.close(); runtime.dispose(); closed = true; listeners.clear() },
  }
}
