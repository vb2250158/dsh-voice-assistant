import { randomUUID } from 'node:crypto'
/** One durable native Session; audio and presenter lifetimes never cancel it. */
export function createNativeSession(ctx, { settings, binding, installTools = () => () => {}, onError = () => {}, speechInstruction = '', speechPolicy = () => ({ enabled: false }), safeDetails = value => value }) {
  let id = binding.get().sessionId || undefined, opening, switching = false, bindingUncertain = false, closed = false, attached
  let persona = settings().persona, turn, attempt, pendingPolicy, snapshot = { revision: 0 }
  const policies = new Map()
  const details = new Map(), attempts = new Map(), responseTexts = new Map()
  const retain = (key, record) => {
    details.delete(key); details.set(key, record)
    while (details.size > 100) details.delete(details.keys().next().value)
  }
  const listeners = new Set(), disposers = [], scoped = []
  const report = error => { try { onError(error) } catch {} }
  const publish = change => {
    snapshot = { revision: snapshot.revision + 1, change }
    for (const fn of listeners) { try { fn() } catch (error) { report(error) } }
  }
  disposers.push(ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (closed || agent.id !== id) return
    if (frame.type === 'start') { attempt = { id: frame.attemptId, turn: frame.turn, step: frame.step }; attempts.set(String(frame.attemptId), `a:${frame.turn}:${frame.step}`); while (attempts.size > 100) attempts.delete(attempts.keys().next().value); return }
    if (frame.attemptId !== attempt?.id) return
    if (frame.type === 'chunk') publish({ kind: 'append', entries: [{ type: 'transient', event: {
      type: 'assistant/live-chunk', data: { attemptId: frame.attemptId, turn: attempt.turn, step: attempt.step, chunk: frame.chunk },
    } }] })
    if (frame.type === 'end') { publish({ kind: 'settle-assistant', attemptId: frame.attemptId }); attempt = undefined }
  }))
  disposers.push(ctx.on('session/event', (session, event) => {
    if (!closed && session.id === id) publish({ kind: 'append', entries: [{ type: 'event', event }] })
  }))
  const attach = async () => {
    const found = await ctx.sessionController.resolveAgent(id)
    if (found.error) throw found.error
    if (closed) throw Error('ASSISTANT_CLOSED')
    if (found.agent === attached) return
    for (const off of scoped.splice(0)) off()
    attached = undefined; turn = undefined; persona = settings().persona
    try {
      // The native preset may already own its persona section. Transform only
      // this scope's presentation through the public waterfall, never duplicate
      // its registration or replace native tools/system policy.
      scoped.push(found.agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const value = await next()
        const section = { name: 'voice-assistant:persona', text: persona + speechInstruction, interpolate: false }
        let replaced = false
        const sections = value.sections.filter(item => item.name !== 'deployment:persona-suffix').map(item => {
          if (item.name !== 'deployment:persona-prefix') return item
          replaced = true; return section
        })
        if (!replaced) sections.unshift(section)
        const policy = speechPolicy(settings())
        pendingPolicy = policy
        const contexts = value.contexts.filter(item => item.name !== 'voice-assistant:speech-capabilities')
        if (policy.enabled) contexts.push({ name: 'voice-assistant:speech-capabilities', text: JSON.stringify({ speechCapabilities: policy }) })
        return { ...value, sections, contexts }
      }))
      scoped.push(found.agent.ctx.on('agent/request-context', async (payload, next) => {
        if (payload.agent.id === id && payload.turn !== turn) { turn = payload.turn; persona = settings().persona; policies.set(turn, pendingPolicy ?? speechPolicy(settings())); if (policies.size > 16) policies.delete(policies.keys().next().value) }
        return next()
      }))
      scoped.push(installTools(found.agent, () => id))
      const assembly = await found.agent.ctx.systemPrompt.assemble({ scope: found.agent })
      if (closed) throw Error('ASSISTANT_CLOSED')
      if (!assembly.sections.some(section => section.name === 'voice-assistant:persona' && section.text === persona + speechInstruction)) throw Error('ASSISTANT_PRESET_COMPLETE_PROMPT')
      attached = found.agent
    } catch (error) { for (const off of scoped.splice(0).reverse()) { try { off() } catch (error) { report(error) } }; throw error }
  }
  const open = () => {
    if (closed) return Promise.reject(Error('ASSISTANT_CLOSED'))
    if (bindingUncertain) return Promise.reject(Error('ASSISTANT_CONTEXT_SWITCH_UNCONFIRMED'))
    if (switching) return Promise.reject(Error('ASSISTANT_CONTEXT_BUSY'))
    if (opening) return opening
    opening = (async () => {
      let saved = binding.get()
      if (!id) {
        const plannedId = randomUUID()
        saved = { ...saved, sessionId: plannedId, creating: true }
        await binding.set(saved)
        id = plannedId
      }
      if (saved.creating) {
        const config = settings()
        const created = await ctx.sessionController.create({ sessionId: id,
          ...(config.cwd ? { cwd: config.cwd } : {}), ...(config.agentPreset ? { agentPreset: config.agentPreset } : {}) })
        if (created.sessionId !== id) throw Error('ASSISTANT_BINDING_CONFLICT')
        await binding.set({ ...binding.get(), sessionId: id, creating: false })
      }
      await attach()
      return id
    })().finally(() => { opening = undefined })
    return opening
  }
  return {
    open, getSessionId: () => id, getModel: () => attached?.model.current(), getSpeechPolicy: turn => policies.get(turn) ?? speechPolicy(settings()),
    contextState() {
      const inbox = attached?.inbox
      return { storage:'native', status:bindingUncertain?'failed':'ready', busy: Boolean(bindingUncertain || switching || opening || !attached || attached.status !== 'idle' || !inbox || inbox.nextTurn.length || inbox.nextStep.length), ...(bindingUncertain?{error:'ASSISTANT_CONTEXT_SWITCH_UNCONFIRMED'}:{}) }
    },
    async clearContext(expectedId) {
      if (closed) throw Error('ASSISTANT_CLOSED')
      if (bindingUncertain) throw Error('ASSISTANT_CONTEXT_SWITCH_UNCONFIRMED')
      if (switching || opening || !attached) throw Error('ASSISTANT_CONTEXT_BUSY')
      if (!expectedId || expectedId !== id) throw Error('ASSISTANT_CONTEXT_STALE')
      const oldId = id, agent = attached, oldBinding = binding.get()
      switching = true
      const queued = () => agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0
      try {
        await agent.runMaintenance(async signal => {
          const state = await ctx.sessionController.state({ sessionId:oldId }, signal)
          if (!state.active || state.running || !Array.isArray(state.queue) || state.queue.length || state.pendingInput.length || queued()) throw Error('ASSISTANT_CONTEXT_BUSY')
          const nextId = randomUUID(), config = settings()
          const created = await ctx.sessionController.create({ sessionId:nextId, ...(config.cwd ? { cwd:config.cwd } : {}), ...(config.agentPreset ? { agentPreset:config.agentPreset } : {}) })
          if (created.sessionId !== nextId) throw Error('ASSISTANT_BINDING_CONFLICT')
          if (queued()) throw Error('ASSISTANT_CONTEXT_BUSY')
          try { await binding.set({ ...oldBinding, sessionId:nextId, creating:false }) }
          catch (error) { bindingUncertain = true; throw Error('ASSISTANT_CONTEXT_SWITCH_UNCONFIRMED', { cause:error }) }
          if (queued()) {
            try { await binding.set(oldBinding) } catch (error) { bindingUncertain = true; throw Error('ASSISTANT_CONTEXT_SWITCH_UNCONFIRMED', { cause:error }) }
            throw Error('ASSISTANT_CONTEXT_BUSY')
          }
          for (const off of scoped.splice(0).reverse()) { try { off() } catch (error) { report(error) } }
          id = nextId; attached = undefined; turn = undefined; attempt = undefined
          policies.clear(); details.clear(); attempts.clear(); responseTexts.clear()
        })
        await attach()
      } finally { switching = false }
      return id
    },
    detailIndex: () => [...details.keys()],
    getSpeechMessageId: responseId => attempts.get(String(responseId)),
    messageDetails(messageId) {
      const record = details.get(messageId)
      if (!record) throw Error('ASSISTANT_MESSAGE_DETAILS_UNAVAILABLE')
      return { message: { ...record.message }, ...safeDetails(record.details) }
    },
    updateSpeechText(responseId, text) {
      const key = attempts.get(String(responseId)), record = details.get(key)
      if (!key || typeof text !== 'string') return
      responseTexts.delete(key); responseTexts.set(key, text.slice(-16000))
      while (responseTexts.size > 100) responseTexts.delete(responseTexts.keys().next().value)
      if (record) record.message.text = responseTexts.get(key)
    },
    recordSpeechDetails(responseId, event) {
      const key = attempts.get(String(responseId))
      if (!key || !event || !['request', 'playback'].includes(event.type)) return false
      const record = details.get(key) ?? { message: { id: key, role: 'assistant', text: responseTexts.get(key) ?? '', source: 'speech' }, details: { kind: 'tts', requests: [], requestCount: 0 } }
      const value = safeDetails(event)
      if (event.type === 'request') {
        if (typeof value?.requestId !== 'string' || !value.requestId || value.requestId.length > 256) return false
        const index = record.details.requests.findIndex(item => item.requestId === value.requestId)
        if (index >= 0) record.details.requests[index] = { ...record.details.requests[index], ...value }
        else { record.details.requestCount++; record.details.requests = [...record.details.requests.slice(-3), value] }
      } else record.details.playback = { status: value.status, ...(value.error ? { error: value.error } : {}) }
      retain(key, record); return true
    },
    eventSource: { getSnapshot: () => snapshot, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) } },
    async submit(text, requestId, { source = 'text', details: speechDetails } = {}) {
      if (switching) throw Error('ASSISTANT_CONTEXT_BUSY')
      if (typeof text !== 'string' || !text.trim() || text.length > 16000) throw Error('ASSISTANT_INPUT_INVALID')
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) throw Error('ASSISTANT_REQUEST_ID_INVALID')
      const sessionId = await open()
      if (closed) throw Error('ASSISTANT_CLOSED')
      if (switching) throw Error('ASSISTANT_CONTEXT_BUSY')
      const key = `u:${requestId}`, previous = details.get(key)
      if (source === 'speech' && speechDetails && !previous) retain(key, { message: { id: key, role: 'user', text, source: 'speech' }, details: safeDetails(speechDetails) })
      try { return await ctx.sessionController.prompt({ sessionId, requestId, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal) }
      catch (error) { if (!previous) details.delete(key); throw error }
    },
    close() {
      if (closed) return
      closed = true; attached = undefined
      for (const off of [...scoped.splice(0).reverse(), ...disposers.splice(0).reverse()]) {
        try { off() } catch (error) { report(error) }
      }
      listeners.clear(); details.clear(); attempts.clear(); responseTexts.clear()
    },
  }
}
