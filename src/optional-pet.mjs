/** Optional display lease. No pet service can own audio, model or tool execution. */
export function optionalPetPresenter(ctx) {
  let current, closed = false
  const retiring = new Set()
  const retire = entry => {
    if (entry.retiring) return entry.retiring
    clearTimeout(entry.timer)
    if (current === entry) current = undefined
    entry.retiring = entry.tail.then(() => entry.lease.dispose())
    retiring.add(entry.retiring)
    void entry.retiring.finally(() => retiring.delete(entry.retiring)).catch(() => {})
    return entry.retiring
  }
  ctx.inject(['petAssistantPresenter'], scope => {
    const service = scope.petAssistantPresenter
    if (closed || service?.protocol !== 1 || typeof service.attach !== 'function') return
    let lease
    try { lease = service.attach() } catch { return }
    const entry = { service, lease, tail: Promise.resolve(), signature: '', error: null }
    current = entry
    scope.effect(() => () => retire(entry))
  })
  return {
    state() {
      if (!current) return { available: false, reason: '需要安装支持助手联动的桌宠版本（0.4.5-fork.3 起）', repository: 'https://github.com/vb2250158/dsh-pet', pets: [] }
      let pets = [], error = current.error
      try { pets = current.service.listPets() } catch { error = 'PET_LIST_UNAVAILABLE' }
      return { available: true, version: current.service.packageVersion, repository: 'https://github.com/vb2250158/dsh-pet', pets, error }
    },
    present(config, view) {
      const entry = current
      if (!entry || closed) return
      entry.latest = { enabled: config.petEnabled, petId: config.petId, bubbles: config.petBubbles,
        animation: config.petAnimation, text: view.text.slice(-4000), responseId: view.responseId }
      if (entry.timer) return
      entry.timer = setTimeout(() => {
        entry.timer = undefined
        entry.tail = entry.tail.then(async () => {
          if (closed || current !== entry) return
          const next = entry.latest, signature = JSON.stringify(next)
          if (entry.signature === signature) return
          entry.signature = signature
          try {
            if (!next.enabled || !next.petId || !next.responseId || (!next.bubbles && !next.animation)) await entry.lease.clear()
            else {
              // Streamed text may refresh the bubble; animate only once per response/pet.
              const animationKey = next.petId + ':' + next.responseId
              await entry.lease.present({ petId: next.petId, text: next.text, bubbles: next.bubbles,
                animation: next.animation && entry.animationKey !== animationKey })
              if (next.animation) entry.animationKey = animationKey
            }
            entry.error = next.enabled && !next.petId ? 'PET_SELECT_REQUIRED' : null
          } catch { entry.error = 'PET_PRESENTATION_FAILED' }
        })
      }, 350)
    },
    async dispose() {
      closed = true
      if (current) retire(current)
      const results = await Promise.allSettled([...retiring])
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
      if (errors.length) throw new AggregateError(errors, 'PET_CLEANUP_FAILED')
    },
  }
}
