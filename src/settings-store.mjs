import { updateProviderProfiles } from '@rabilink/desktop-voice-service/provider-profiles'
import { ResidentSettingsSchema, validateResidentSettings } from './resident-settings.mjs'

/** Native persistence owns values. Preview never writes; a batch commits one revision. */
export function createSettingsStore(service, namespace, readConfig) {
  if (typeof readConfig !== 'function') throw Error('ASSISTANT_LIVE_CONFIG_REQUIRED')
  let closed = false, chain = Promise.resolve()
  const descriptor = () => {
    const row = service.describe({ redactSecrets: true }).find(row => row.ns === namespace)
    if (!row) throw Error('ASSISTANT_SETTINGS_UNAVAILABLE')
    return row
  }
  // Loader Config is available during apply; Settings descriptors require an ACTIVE fiber.
  const read = () => ResidentSettingsSchema(readConfig())
  const apply = (before, patches) => {
    if (!Array.isArray(patches) || patches.length > 64) throw Error('ASSISTANT_SETTINGS_INVALID')
    let next = before
    for (const patch of patches) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)
        || Object.hasOwn(patch, 'speechProfiles') || Object.keys(patch).some(key => !Object.hasOwn(before, key))) throw Error('ASSISTANT_SETTINGS_INVALID')
      next = validateResidentSettings(updateProviderProfiles(next, patch, 'dsh'))
    }
    return next
  }
  const saveBatch = patches => {
    const result = chain.then(async () => {
      if (closed) throw Error('ASSISTANT_CLOSED')
      const current = descriptor(), before = ResidentSettingsSchema(current.value)
      const next = apply(before, patches)
      if (patches.length) await service.update(namespace, next, current.revision)
      return next
    })
    chain = result.catch(() => {})
    return result
  }
  return {
    read,
    preview(patches) { if (closed) throw Error('ASSISTANT_CLOSED'); return apply(read(), patches) },
    save(patch) { return saveBatch([patch]) },
    saveBatch,
    async close() { closed = true; await chain },
  }
}
