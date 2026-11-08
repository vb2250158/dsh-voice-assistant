import { createResidentHost as createSharedResidentHost } from '@rabilink/desktop-voice-service/host'
import { createSpeechProviders } from '@rabilink/desktop-voice-service/speech-providers'
import { speechProviders } from '@rabilink/desktop-voice-service/provider-profiles'
import { createNativeSession } from './native-session.mjs'
import { observeSessionOutput } from './session-output.mjs'

/** Bind the shared resident host to the DSH native session and tools. */
export function createResidentHost({ ctx, binding, installTools, ...options }) {
  let presets, native
  ctx.inject(['agentPresets'], scope => {
    const lease = { service: scope.agentPresets }
    presets = lease
    scope.effect(() => () => { if (presets === lease) presets = undefined })
  })
  const host = createSharedResidentHost({
    ...options,
    conversation: ({ onError }) => (native = createNativeSession(ctx, { settings: options.settings, binding, installTools, onError })),
    observeOutput: ({ conversation, ...args }) => observeSessionOutput({ eventSource: conversation.eventSource, ...args }),
    createProviders: config => createSpeechProviders({ config, credentials: options.credentials }),
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
    return { ...state, selectedModel: current,
      capabilities: { host: 'dsh', speechProviders, hostModels: await modelCatalog(),
        ...(catalogError ? { hostModelsError: catalogError } : {}),
        ...(availablePresets ? { presets: availablePresets } : {}),
      },
    }
  }
  return { ...host, state: async () => withCapabilities(await host.state()),
    async command(request) {
      if (request.action === 'settings' && request.patch?.agentPreset !== undefined) {
        const state = await host.state()
        if (state.sessionId && request.patch.agentPreset !== state.settings.agentPreset) throw Error('ASSISTANT_PRESET_SESSION_LOCKED')
      }
      if (request.action === 'select-model') {
        if (typeof request.provider !== 'string' || typeof request.model !== 'string' || !request.provider || !request.model) throw Error('ASSISTANT_MODEL_INVALID')
        const { sessionId } = await host.command({ action: 'prepare' })
        const result = await ctx.sessionController.selectModel({ sessionId, provider: request.provider, model: request.model })
        selectedModel = result.selected
        return withCapabilities(await host.state())
      }
      if (request.action === 'refresh-models') { await modelCatalog(true); return withCapabilities(await host.state()) }
      const result = await host.command(request)
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
