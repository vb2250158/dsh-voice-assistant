/** Adapt a host-owned WAV request and browser audio element to shared playback. */
export function createDesktopTts({ requestAudio, createAudio, createUrl, revokeUrl }) {
  return {
    canSynthesize: () => true,
    async synthesize(text, options = {}) {
      const controller = new AbortController()
      const signal = options.signal
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      let url
      let audio
      try {
        const blob = await requestAudio(text, controller.signal)
        controller.signal.throwIfAborted()
        url = createUrl(blob)
        audio = createAudio(url)
      } catch (error) {
        if (url !== undefined) revokeUrl(url)
        signal?.removeEventListener('abort', abort)
        throw error
      }
      let destroyed = false
      return {
        task: { abort },
        player: {
          audioPlayer: audio,
          play: () => audio.play(),
          stop: () => audio.pause(),
          destroy() {
            if (destroyed) return
            destroyed = true
            signal?.removeEventListener('abort', abort)
            audio.pause()
            audio.removeAttribute('src')
            audio.load()
            revokeUrl(url)
          },
        },
      }
    },
  }
}
