import { Recording, audioBase64 } from 'dsh-speech-service/capture'
import { createDesktopAsr } from './desktop-asr.mjs'
import { createDesktopTts } from './desktop-tts.mjs'
import { createDesktopAssistant } from './desktop-assistant.mjs'

/** Connect the native Session, authenticated speech Remote and same-origin synthesis. */
export function createDesktopHost({ sessions, speech, fetchAudio, preferences, agentPreset, onError, browser }) {
  let catalog
  let assistant
  const clock = { now: () => browser.performance.now(), setTimeout: (...args) => browser.setTimeout(...args),
    clearTimeout: id => browser.clearTimeout(id), setInterval: (...args) => browser.setInterval(...args), clearInterval: id => browser.clearInterval(id) }
  const asr = createDesktopAsr({ clock, createRecording: () => new Recording(() => {}),
    settings: () => {
      if (!catalog) throw new Error('SPEECH_CATALOG_UNAVAILABLE')
      const value = preferences()
      return { threshold: value.threshold, silenceMs: value.silenceMs, sampleMs: value.sampleMs,
        maxDurationMs: Math.floor(catalog.maxDurationSeconds * 1000) }
    },
    transcribe: async (audio, signal) => {
      if (!catalog || audio.byteLength > catalog.maxAudioBytes) throw new Error('SPEECH_AUDIO_LIMIT')
      const result = await speech.transcribe({ audioBase64: audioBase64(audio), ...catalog.selection }, signal)
      if (!result.ok) throw result.error
      return result.value
    },
  })
  const tts = createDesktopTts({
    async requestAudio(text, signal) {
      const sessionId = assistant.getSessionId()
      if (!sessionId) throw new Error('ASSISTANT_SESSION_UNAVAILABLE')
      const response = await fetchAudio('/rabiroute/speech', { method: 'POST', signal,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, sessionId }) })
      if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/wav')) throw new Error('SPEECH_SYNTHESIS_UNAVAILABLE')
      const blob = await response.blob()
      if (blob.size > 32 * 1024 * 1024) throw new Error('SPEECH_AUDIO_LIMIT')
      return blob
    },
    createAudio: url => new browser.Audio(url), createUrl: blob => browser.URL.createObjectURL(blob), revokeUrl: url => browser.URL.revokeObjectURL(url),
  })
  assistant = createDesktopAssistant({ sessions, asr, tts, agentPreset, onError, maxVisibleMessages: preferences().maxVisibleMessages })
  return {
    ...assistant,
    async prepareMicrophone() {
      const result = await speech.catalog()
      if (!result.ok) throw result.error
      catalog = result.value
      return catalog
    },
  }
}
