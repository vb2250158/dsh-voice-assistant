import { createResidentHost as createSharedResidentHost } from '@rabilink/desktop-voice-service/host'
import { createSpeechProviders } from '@rabilink/desktop-voice-service/speech-providers'
import { createResidentWake, parseWakeAliases } from '@rabilink/desktop-voice-service/resident-speech'
import { speechProviders } from '@rabilink/desktop-voice-service/provider-profiles'
import { speechExpressionPolicy } from '@rabilink/desktop-voice-service/expression'
import { speechExpressionInstruction, createSpeechExpressionDecoder } from '@rabilink/assistant-runtime/voice'
import { safeSpeechDetails, asrAgentContext } from '@rabilink/desktop-voice-service/speech-details'
import { createNativeSession } from './native-session.mjs'
import { installNativeCanvas } from './canvas-native.mjs'
import { observeSessionOutput } from './session-output.mjs'

/** Align player attempt identities with the native Chat message identities. */
export function projectSpeechProgress(progress, messageId) {
  return progress?.map(item => ({ ...item, responseId: messageId(item.responseId) ?? item.responseId }))
}

/** Bind the shared resident host to the DSH native session and tools. */
export function createResidentHost({ ctx, binding, installTools, speechContext, canvasContext, defineTool, residentSpeech, ...options }) {
  let presets, native, closing = false, wakeSettings, wakeError
  let wakeUpdate = Promise.resolve()
  const wake = residentSpeech && createResidentWake({
    speechRuntime: residentSpeech,
    acquireTarget: () => ({ host, conversation: { activity: () => ({ pending: native.contextState().busy }) } }),
    assertCurrent() {
      if (closing || !options.settings().keywordWakeEnabled || !host.voiceEnabled()) throw Error('ASSISTANT_WAKE_DISABLED')
    },
    canStart() {
      const config = options.settings()
      return Boolean(config.ttsModel && config.ttsVoice && (config.asrMode === 'native' ? options.speech?.() : config.asrModel))
    },
    shouldUseFallback: () => true,
  })
  function syncWake() {
    if (!wake || closing) return Promise.resolve()
    const update = wakeUpdate.then(async () => {
      if (closing) return
      const config = options.settings()
      let aliases
      try {
        aliases = config.keywordWakeEnabled && host.voiceEnabled() ? parseWakeAliases(config.keywordWakeAliases) : []
        if (config.keywordWakeEnabled && host.voiceEnabled() && !aliases.length) throw Error('ASSISTANT_WAKE_ALIASES_REQUIRED')
        wakeError = undefined
      } catch (error) {
        aliases = []
        wakeError = error.message
      }
      const key = JSON.stringify(aliases)
      if (wakeSettings === key) return
      await wake.stop({ stopCapture: true })
      if (aliases.length && !closing) wake.arm(aliases)
      wakeSettings = key
    })
    wakeUpdate = update.catch(error => { wakeError = 'ASSISTANT_WAKE_SERVICE_UNAVAILABLE'; options.diagnose?.('wake-sync', error) })
    return update
  }
  ctx.inject(['agentPresets'], scope => {
    const lease = { service: scope.agentPresets }
    presets = lease
    scope.effect(() => () => { if (presets === lease) presets = undefined })
  })
  const host = createSharedResidentHost({
    ...options,
    supportsDynamicExpression: true,
    onCaptureActivity: wake?.captureActivity, onCaptureStopped: wake?.captureStopped,
    conversation: ({ onError }) => (native = createNativeSession(ctx, { settings: options.settings, binding, installTools, onError, canvasContext, defineTool, installNativeCanvas, speechPolicy: speechExpressionPolicy, speechInstruction: speechExpressionInstruction({ enabled: true }), safeDetails: safeSpeechDetails, asrAgentContext, speechContext, createDecoder: createSpeechExpressionDecoder })),
    observeOutput: ({ conversation, onText, onCanvas, ...args }) => observeSessionOutput({ eventSource: conversation.eventSource, onCanvas, createDecoder: createSpeechExpressionDecoder, speechPolicy: conversation.getSpeechPolicy, onText: value => { conversation.updateSpeechText(value.responseId, value.text); onText(value) }, ...args }),
    createProviders: (config, { recognitionContext } = {}) => createSpeechProviders({ config, credentials: options.credentials, recognitionContext }),
  })
  let catalogCache, catalogAt = 0, selectedModel, catalogError
  async function modelCatalog(refresh = false) {
    if (!refresh && catalogCache && Date.now() - catalogAt < 30000) return catalogCache
    try {
      const catalog = await ctx.sessionController.modelCatalog()
      catalogCache = catalog.groups.flatMap(group => group.models.map(model => ({
        provider: group.id, model: model.id, label: model.name, providerLabel: group.name,
      })))
      catalogError = undefined
    } catch (error) {
      catalogError = 'ASSISTANT_MODEL_CATALOG_UNAVAILABLE'
      catalogCache = []
    }
    catalogAt = Date.now()
    return catalogCache
  }
  const withCapabilities = async state => {
    let current, availablePresets
    try { current = native?.getModel() ?? selectedModel ?? null }
    catch (error) { options.diagnose?.('model-read', error); throw error }
    if (presets) {
      try { availablePresets = (await presets.service.list()).filter(item => !item.broken).map(item => ({ id: item.id, label: item.name || item.id })) }
      catch (error) { options.diagnose?.('preset-list', error); throw error }
    }
    const context = native?.contextState()
    const speechProgress = projectSpeechProgress(state.speechProgress, id => native?.getSpeechMessageId(id))
    return { ...state, ...(speechProgress ? { speechProgress } : {}), selectedModel: current, messageDetailsIndex: native?.detailIndex() ?? [], context: context && { ...context, busy: context.busy || state.voice.phase !== 'stopped' },
      ...(wake ? { keywordWake: wakeError ? { phase: 'unavailable', error: wakeError } : wake.snapshot() } :
        state.settings.keywordWakeEnabled ? { keywordWake: { phase: 'unavailable', error: 'ASSISTANT_WAKE_SERVICE_UNAVAILABLE' } } : {}),
      capabilities: { host: 'dsh', contextManagement: true, speechProviders, hostModels: await modelCatalog(), keywordWake: Boolean(wake),
        ...(catalogError ? { hostModelsError: catalogError } : {}),
        ...(availablePresets ? { presets: availablePresets } : {}),
      },
    }
  }
  return { ...host, syncWake, state: async () => withCapabilities(await host.state()),
    async initialize() { await host.initialize(); await syncWake().catch(() => {}) },
    async dispose() {
      if (closing) return
      closing = true
      await wakeUpdate
      try { await wake?.stop() } finally { await host.dispose() }
    },
    async command(request) {
      if (request.action === 'clear-context') {
        if (request.confirm !== true) throw Error('ASSISTANT_CONTEXT_CONFIRM_REQUIRED')
        if ((await host.state()).voice.phase !== 'stopped') throw Error('ASSISTANT_STOP_VOICE_BEFORE_CLEAR')
        await native.clearContext(request.sessionId)
        return withCapabilities(await host.state())
      }
      if (request.action === 'settings') {
        const patches = Array.isArray(request.patches) ? request.patches : [request.patch]
        if (patches.some(patch => patch && (Object.hasOwn(patch, 'keywordWakeEnabled') || Object.hasOwn(patch, 'keywordWakeAliases')))) {
          const draft = options.previewSettings(patches)
          if (draft.keywordWakeEnabled && !wake) throw Error('ASSISTANT_WAKE_SERVICE_UNAVAILABLE')
        }
        if (patches.some(patch => patch && Object.hasOwn(patch, 'agentPreset'))) {
          const state = await host.state()
          if (state.sessionId && patches.some(patch => patch && Object.hasOwn(patch, 'agentPreset') && patch.agentPreset !== state.settings.agentPreset)) throw Error('ASSISTANT_PRESET_SESSION_LOCKED')
        }
      }
      if (request.action === 'select-model') {
        if (typeof request.provider !== 'string' || typeof request.model !== 'string' || !request.provider || !request.model) throw Error('ASSISTANT_MODEL_INVALID')
        const { sessionId } = await host.command({ action: 'prepare' })
        const result = await ctx.sessionController.selectModel({ sessionId, provider: request.provider, model: request.model })
        selectedModel = result.selected
        return withCapabilities(await host.state())
      }
      if (request.action === 'refresh-models') { await modelCatalog(true); return withCapabilities(await host.state()) }
      let result
      if (request.action === 'start' && await wake?.startManual()) result = await host.state()
      else result = await host.command(request)
      if (request.action === 'settings') await syncWake()
      if (request.action === 'stop') await wake?.drainHandoff()
      if (['prepare', 'start'].includes(request.action)) {
        const sessionId = result.sessionId ?? (await host.state()).sessionId
        if (sessionId) {
          const resolved = await ctx.sessionController.resolveAgent(sessionId)
          if (resolved.error) throw resolved.error
          selectedModel = resolved.agent.model.current() ?? null
        }
      }
      return result && result.voice ? withCapabilities(result) : result
    },
  }
}
