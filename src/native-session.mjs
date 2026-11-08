import { randomUUID } from 'node:crypto'
/** One durable native Session; audio and presenter lifetimes never cancel it. */
export function createNativeSession(ctx, { settings, binding, installTools = () => () => {}, onError = () => {} }) {
  let id = binding.get().sessionId || undefined, opening, closed = false, attached
  let persona = settings().persona, turn, attempt, snapshot = { revision: 0 }
  const listeners = new Set(), disposers = [], scoped = []
  const report = error => { try { onError(error) } catch {} }
  const publish = change => {
    snapshot = { revision: snapshot.revision + 1, change }
    for (const fn of listeners) { try { fn() } catch (error) { report(error) } }
  }
  disposers.push(ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (closed || agent.id !== id) return
    if (frame.type === 'start') { attempt = { id: frame.attemptId, turn: frame.turn, step: frame.step }; return }
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
        const section = { name: 'voice-assistant:persona', text: persona, interpolate: false }
        let replaced = false
        const sections = value.sections.filter(item => item.name !== 'deployment:persona-suffix').map(item => {
          if (item.name !== 'deployment:persona-prefix') return item
          replaced = true; return section
        })
        if (!replaced) sections.unshift(section)
        return { ...value, sections }
      }))
      scoped.push(found.agent.ctx.on('agent/request-context', async (payload, next) => {
        if (payload.agent.id === id && payload.turn !== turn) { turn = payload.turn; persona = settings().persona }
        return next()
      }))
      scoped.push(installTools(found.agent, () => id))
      const assembly = await found.agent.ctx.systemPrompt.assemble({ scope: found.agent })
      if (closed) throw Error('ASSISTANT_CLOSED')
      if (!assembly.sections.some(section => section.name === 'voice-assistant:persona' && section.text === persona)) throw Error('ASSISTANT_PRESET_COMPLETE_PROMPT')
      attached = found.agent
    } catch (error) { for (const off of scoped.splice(0).reverse()) { try { off() } catch (error) { report(error) } }; throw error }
  }
  const open = () => {
    if (closed) return Promise.reject(Error('ASSISTANT_CLOSED'))
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
    open, getSessionId: () => id, getModel: () => attached?.model.current(),
    eventSource: { getSnapshot: () => snapshot, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) } },
    async submit(text, requestId) {
      if (typeof text !== 'string' || !text.trim() || text.length > 16000) throw Error('ASSISTANT_INPUT_INVALID')
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) throw Error('ASSISTANT_REQUEST_ID_INVALID')
      const sessionId = await open()
      if (closed) throw Error('ASSISTANT_CLOSED')
      return ctx.sessionController.prompt({ sessionId, requestId, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal)
    },
    close() {
      if (closed) return
      closed = true; attached = undefined
      for (const off of [...scoped.splice(0).reverse(), ...disposers.splice(0).reverse()]) {
        try { off() } catch (error) { report(error) }
      }
      listeners.clear()
    },
  }
}
