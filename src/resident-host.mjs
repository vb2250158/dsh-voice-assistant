import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createResidentInteraction } from '@rabilink/assistant-runtime/resident'
import { openDesktopVoiceServices } from '@rabilink/desktop-voice-service/services'
import { createHttpSpeechProviders } from '@rabilink/desktop-voice-service/providers'
import { createNativeSession } from './native-session.mjs'
import { observeSessionOutput } from './session-output.mjs'
import { captionSettings } from './presenter-settings.mjs'

/** Native Host owns audio. Client and pet only issue commands and present state. */
export function createResidentHost({ ctx, settings, saveSettings, binding, credentials, installTools, openSettings = () => {}, deviceFactory, speech = () => undefined, pet }) {
  if (typeof deviceFactory !== 'function') throw Error('ASSISTANT_DEVICE_FACTORY_REQUIRED')
  let device, closed = false, diagnostic, diagnosticAbort, presentationTimer, error = null, revision = 0
  let failedDiagnostic
  const failedPresenters = new WeakSet()
  let presentation = { statusText: '语音已停止', text: '', outputEnabled: settings().outputEnabled, capturePaused: true }
  const changed = () => { revision++; pet?.present(settings(), presentation); publishPresentation() }
  const report = value => { error = /^[A-Z][A-Z0-9_]{1,100}$/.test(value?.message) ? value.message : 'ASSISTANT_OPERATION_FAILED'; changed() }
  const native = createNativeSession(ctx, { settings, binding, installTools, onError: report })
  const providers = config => createHttpSpeechProviders({
    ...(config.asrMode === 'compatible' ? { asr: { endpoint: config.asrEndpoint, model: config.asrModel, credentialRef: 'asr' } } : {}),
    tts: { endpoint: config.ttsEndpoint, model: config.ttsModel, voice: config.ttsVoice, credentialRef: 'tts' },
    resolveCredential: kind => credentials.resolve(kind, config[kind + 'Endpoint']),
  })
  const newDevice = (config, signal) => deviceFactory({
    electronExecutable: config.electronExecutable || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'electron', 'electron.exe'),
    inputDeviceId: config.inputDeviceId, outputDeviceId: config.outputDeviceId, maxDurationMs: 30000, signal, onEvent: deviceEvent,
  })
  async function deviceEvent(event) {
    if (closed) return
    if (event.type === 'device-error' || event.type === 'cleanup-error') { report(Error(event.error)); return }
    if (event.event === 'presenter.bounds') {
      const b = event.bounds
      if (b && ['x','y','width','height'].every(key => Number.isFinite(b[key]))) {
        await saveSettings({ captionHasBounds: true, captionX: b.x, captionY: b.y, captionWidth: b.width, captionHeight: b.height })
      }
      return
    }
    if (event.event !== 'presenter.action') return
    try {
      const config = settings()
      switch (event.action) {
        case 'open-settings': await openSettings(); break
        case 'toggle-capture': await command({ action: voice.getState().capture === 'listening' ? 'pause' : 'resume' }); break
        case 'toggle-output': await command({ action: 'mute', enabled: !voice.getState().outputEnabled }); break
        case 'toggle-caption-lock': await command({ action: 'settings', patch: { captionLocked: !config.captionLocked } }); break
        case 'toggle-captions': await command({ action: 'settings', patch: { captionsEnabled: !config.captionsEnabled } }); break
        case 'captions-hide': await command({ action: 'settings', patch: { captionsEnabled: false } }); break
        case 'stop': await command({ action: 'stop' }); break
      }
    } catch (failure) { report(failure) }
  }
  function publishPresentation() {
    if (!device || failedPresenters.has(device) || closed || presentationTimer) return
    presentationTimer = setTimeout(() => {
      presentationTimer = undefined
      const target = device
      if (target) void target.present(presentation).catch(error => { failedPresenters.add(target); report(error) })
    }, 50)
  }
  const voice = createResidentInteraction({ outputEnabled: settings().outputEnabled,
    async openServices({ signal }) {
      if (failedDiagnostic) throw Error('ASSISTANT_DEVICE_CLEANUP_UNCONFIRMED')
      if (diagnostic) throw Error('ASSISTANT_DEVICE_TEST_BUSY')
      const config = settings(), http = providers(config)
      if (!config.ttsModel || !config.ttsVoice) throw Error('SPEECH_TTS_MODEL_REQUIRED')
      if (config.asrMode === 'compatible' && !config.asrModel) throw Error('SPEECH_ASR_MODEL_REQUIRED')
      let catalog, nativeSpeech
      if (config.asrMode === 'native') {
        nativeSpeech = speech()
        if (!nativeSpeech) throw Error('SPEECH_NATIVE_UNAVAILABLE')
        catalog = await nativeSpeech.catalog()
      }
      await native.open(); signal.throwIfAborted()
      const opened = await newDevice(config, signal)
      device = opened
      try {
        await opened.configurePresenter(captionSettings(config))
        const services = await openDesktopVoiceServices({ openDevice: async () => opened, signal, settings: { ...config, maxDurationMs: 30000 },
          synthesize: http.synthesize,
          recognize: config.asrMode === 'compatible' ? http.recognize : (audio, signal) => {
            if (audio.byteLength > catalog.maxAudioBytes) throw Error('SPEECH_AUDIO_LIMIT')
            if (speech() !== nativeSpeech) throw Error('SPEECH_NATIVE_UNAVAILABLE')
            return nativeSpeech.transcribe({ audioBase64: Buffer.from(audio).toString('base64'),
              ...(config.asrProviderId ? { providerId: config.asrProviderId } : {}) }, signal)
          }, onError: report,
        })
        return { runtime: services.runtime, async dispose() { await services.dispose(); if (device === opened) device = undefined } }
      } catch (failure) { await opened.close(); if (device === opened) device = undefined; throw failure }
    },
    onInput: input => native.submit(input.text, randomUUID()),
    onError: report,
    onEvent(event) {
      if (event.type === 'state') {
        const s = event.state
        presentation = { ...presentation, outputEnabled: s.outputEnabled, capturePaused: s.capture !== 'listening',
          statusText: s.phase === 'failed' ? '语音故障' : s.phase === 'starting' ? '正在准备' : s.phase === 'stopped' ? '语音已停止' : s.capture === 'listening' ? '正在聆听' : '麦克风已暂停' }
      } else {
        const e = event.event
        if (e.type === 'transcript') presentation = { ...presentation, text: e.text, responseId: null }
        if (e.type === 'input') presentation = { ...presentation, text: e.input.text, statusText: '正在处理', responseId: null }
      }
      changed()
    },
  })
  const unobserve = observeSessionOutput({ eventSource: native.eventSource, voice, onError: report,
    onText(value) { presentation = { ...presentation, ...value }; changed() },
  })
  async function testDevice(action) {
    if (failedDiagnostic) throw Error('ASSISTANT_DEVICE_CLEANUP_UNCONFIRMED')
    if (diagnostic || voice.getState().phase === 'starting') throw Error('ASSISTANT_DEVICE_TEST_BUSY')
    if (device && action === 'devices') return device.enumerateDevices()
    if (device) throw Error('ASSISTANT_STOP_VOICE_BEFORE_TEST')
    diagnosticAbort = new AbortController()
    const signal = diagnosticAbort.signal
    diagnostic = (async () => {
      const opened = await newDevice(settings(), signal)
      try {
        if (action === 'devices') return await opened.enumerateDevices()
        if (action === 'test-microphone') {
          const recording = opened.createRecording(); let peak = 0, failure
          try {
            await recording.start(err => { failure = err })
            for (let i = 0; i < 30; i++) { await delay(100, undefined, { signal }); peak = Math.max(peak, recording.amplitude()); if (failure) throw failure }
            const audio = await recording.take()
            return { bytes: audio.byteLength, peak, audible: peak > .001, message: peak > .001 ? '检测到输入信号' : '输入为静音，请检查设备选择和系统麦克风音量' }
          } finally { await recording.dispose() }
        }
        if (action === 'test-playback') {
          const audio = await providers(settings()).synthesize('你好，语音助手已准备好。', signal)
          const player = await opened.createPlayer(audio)
          try {
            await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(Error('SPEECH_PLAYBACK_TIMEOUT')), 20000)
              const done = error => { clearTimeout(timer); signal.removeEventListener('abort', aborted); error ? reject(error) : resolve() }
              const aborted = () => done(Error('SPEECH_TEST_CANCELLED'))
              signal.addEventListener('abort', aborted, { once: true })
              player.events.addEventListener('ended', () => done(), { once: true }); player.events.addEventListener('error', () => done(Error('SPEECH_PLAYBACK_FAILED')), { once: true })
              void player.play().catch(done)
            })
            return { played: true, message: '播放已结束，请确认扬声器是否有声音' }
          } finally { await player.destroy() }
        }
        throw Error('ASSISTANT_ACTION_INVALID')
      } finally { try { await opened.close() } catch (error) { failedDiagnostic = opened; throw error } }
    })().finally(() => { diagnostic = undefined; diagnosticAbort = undefined })
    return diagnostic
  }
  async function command(request) {
    if (closed) throw Error('ASSISTANT_CLOSED')
    error = null
    switch (request.action) {
      case 'prepare': return { sessionId: await native.open() }
      case 'text': return native.submit(request.text, request.requestId)
      case 'start': await voice.start(); return state()
      case 'stop': diagnosticAbort?.abort(); await diagnostic?.catch(() => {}); await voice.stop(); return state()
      case 'pause': voice.pauseCapture(); return state()
      case 'resume': await voice.resumeCapture(); return state()
      case 'mute': await saveSettings({ outputEnabled: Boolean(request.enabled) }); voice.setOutputEnabled(Boolean(request.enabled)); return state()
      case 'settings': {
        const patch = request.patch
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('ASSISTANT_SETTINGS_INVALID')
        const audioKeys = ['asrMode','asrProviderId','asrEndpoint','asrModel','ttsEndpoint','ttsModel','ttsVoice','inputDeviceId','outputDeviceId','electronExecutable']
        if (audioKeys.some(key => key in patch)) { diagnosticAbort?.abort(); await diagnostic?.catch(() => {}); await voice.stop() }
        await saveSettings(patch)
        voice.setOutputEnabled(settings().outputEnabled)
        await device?.configurePresenter(captionSettings(settings()))
        changed()
        return state()
      }
      case 'credential': return credentials.set(request.kind, settings()[request.kind + 'Endpoint'], request.key)
      case 'devices': case 'test-microphone': case 'test-playback': return testDevice(request.action)
      case 'test-asr': {
        if (settings().asrMode !== 'native') throw Error('SPEECH_USE_MICROPHONE_TEST_FOR_COMPATIBLE_ASR')
        const service = speech()
        if (!service) throw Error('SPEECH_NATIVE_UNAVAILABLE')
        const catalog = await service.catalog()
        return { available: true, catalog }
      }
      default: throw Error('ASSISTANT_ACTION_INVALID')
    }
  }
  async function state() {
    const config = settings()
    const describe = async kind => {
      try { return await credentials.describe(kind, config[kind + 'Endpoint']) }
      catch { return { configured: false, writable: false, error: 'SPEECH_ENDPOINT_INVALID' } }
    }
    return { revision, sessionId: native.getSessionId() ?? null, voice: voice.getState(), presentation, error, settings: config,
      credentials: { asr: await describe('asr'), tts: await describe('tts') },
      pet: pet?.state() ?? { available: false, reason: '未安装兼容桌宠', repository: 'https://github.com/vb2250158/dsh-pet', pets: [] } }
  }
  return { state, command, openSettings(url) {
    if (!device) throw Error('ASSISTANT_DEVICE_UNAVAILABLE')
    return device.request('presenter.open-settings', { url })
  }, async dispose() {
    if (closed) return; closed = true; clearTimeout(presentationTimer); diagnosticAbort?.abort()
    unobserve(); native.close(); await diagnostic?.catch(() => {})
    const results = await Promise.allSettled([voice.dispose(), pet?.dispose(), failedDiagnostic?.close()])
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
    if (errors.length) throw new AggregateError(errors, 'ASSISTANT_CLEANUP_UNCONFIRMED')
  } }
}
