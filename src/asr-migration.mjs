/** Apply the requested ASR capability defaults once through the settings owner. */
export function createAsrMigration({ store, ledger, fields }) {
  const key = 'asr_capabilities_202611', features = Object.fromEntries(fields
    .filter(field => field.feature === true && field.type === 'boolean')
    .map(field => [field.key, true]))
  let pending, closed = false
  function run() {
    if (closed) return Promise.reject(Error('ASSISTANT_CLOSED'))
    if (ledger.get(key)?.applied) return Promise.resolve()
    if (pending) return pending
    pending = (async () => {
      const before = store.read(), patch = { ...features, asrRecognitionMode:'twopass', asrSystemReservedFilter:false, asrFilterWithEmpty:'', asrFilterWithSigned:'' }
      const patches = before.asrMode === 'volcengine' ? [patch] : [{ asrMode:'volcengine' }, patch, { asrMode:before.asrMode }]
      await store.saveBatch(patches)
      await ledger.put(key, { applied:true })
    })().finally(() => { pending = undefined })
    return pending
  }
  return { run, async close() { closed = true; await pending?.catch(() => {}) } }
}
