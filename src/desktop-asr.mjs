/** Adapt bounded desktop recording and Host transcription to the shared listening lifecycle. */
export function createDesktopAsr({ createRecording, transcribe, settings, clock }) {
  const rounds = new WeakMap()
  const retire = round => {
    const state = rounds.get(round)
    if (!state || state.closed) return
    state.closed = true
    clock.clearInterval(state.monitor)
    clock.clearTimeout(state.deadline)
    state.abort.abort()
    try { Promise.resolve(state.recording.dispose()).catch(state.onCleanupError) }
    catch (error) { state.onCleanupError(error) }
  }
  return {
    createRound(handlers) {
      const round = {}
      rounds.set(round, { handlers, recording: createRecording(), abort: new AbortController(), closed: false,
        speaking: false, quietSince: undefined, monitor: undefined, deadline: undefined, finishing: false,
        onCleanupError: error => handlers.onError?.(error) })
      return round
    },
    async start(round) {
      const state = rounds.get(round)
      if (!state || state.closed) throw new Error('DESKTOP_ASR_ROUND_INVALID')
      const config = settings()
      if (!config || !Number.isFinite(config.threshold) || config.threshold <= 0 || config.threshold > 1
        || !Number.isSafeInteger(config.silenceMs) || config.silenceMs < 1
        || !Number.isSafeInteger(config.maxDurationMs) || config.maxDurationMs < config.silenceMs
        || !Number.isSafeInteger(config.sampleMs) || config.sampleMs < 1) throw new Error('DESKTOP_ASR_SETTINGS_INVALID')
      const end = async () => {
        if (state.closed || state.finishing) return
        state.finishing = true
        clock.clearInterval(state.monitor); clock.clearTimeout(state.deadline)
        try {
          if (state.speaking) {
            state.handlers.onSpeechEnd?.()
            const audio = await state.recording.stop(config.maxDurationMs / 1000)
            if (state.closed) return
            const result = await transcribe(audio, state.abort.signal)
            if (state.closed) return
            if (typeof result?.text === 'string' && result.text.trim()) state.handlers.onFinal?.(result)
          }
          if (!state.closed) state.handlers.onEnd?.()
        } catch (error) { if (!state.closed) state.handlers.onError?.(error) }
        finally { retire(round) }
      }
      try {
        await state.recording.start(error => { if (!state.closed) { state.handlers.onError?.(error); retire(round) } })
        if (state.closed) return
        state.handlers.onStart?.()
        if (state.closed) return
        state.deadline = clock.setTimeout(() => { void end() }, config.maxDurationMs)
        state.monitor = clock.setInterval(() => {
          if (state.closed || state.finishing) return
          if (state.recording.amplitude() >= config.threshold) {
            state.quietSince = undefined
            if (!state.speaking) { state.speaking = true; state.handlers.onSpeechStart?.() }
          } else if (state.speaking) {
            state.quietSince ??= clock.now()
            if (clock.now() - state.quietSince >= config.silenceMs) void end()
          }
        }, config.sampleMs)
      } catch (error) { retire(round); throw error }
    },
    stop(round) { retire(round) },
  }
}
