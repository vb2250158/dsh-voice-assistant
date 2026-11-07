import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { openDesktopDevice } from '@rabilink/desktop-voice-service/node'
import { ResidentSettingsSchema } from './resident-settings.mjs'
import { createSettingsStore } from './settings-store.mjs'
import { optionalNativeSpeech } from './optional-speech.mjs'
import { optionalPetPresenter } from './optional-pet.mjs'
import { createSpeechCredentials } from './speech-credentials.mjs'
import { createResidentHost } from './resident-host.mjs'
import { installNativeManagement } from './native-management.mjs'

export const name = 'dsh-voice-assistant'
export const inject = ['settings','credentials','storageDomain','connection','sessionController']
export const Config = ResidentSettingsSchema.volatile().default({})
export const domainSpec = defineDomain({ name: 'voice_assistant', version: 1,
  global: { schema: z.object({ sessionId: z.string().optional(), creating: z.boolean().optional() }), initial: {} },
  tables: { requests: domainTable(z.object({ fingerprint: z.string(), sessionId: z.string(), requestId: z.string(),
    status: z.string(), result: z.record(z.string(), z.unknown()).optional() })) },
})
const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control':'no-store' } })
async function readCommand(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw Error('ASSISTANT_JSON_REQUIRED')
  const reader = request.body?.getReader()
  if (!reader) throw Error('ASSISTANT_BODY_REQUIRED')
  const chunks = []; let length = 0
  try { for (;;) { const {done,value} = await reader.read(); if (done) break; length += value.byteLength; if (length > 65536) throw Error('ASSISTANT_BODY_TOO_LARGE'); chunks.push(value) } }
  finally { await reader.cancel(); reader.releaseLock() }
  const bytes = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  const value = JSON.parse(new TextDecoder().decode(bytes))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('ASSISTANT_COMMAND_INVALID')
  return value
}
/** Auth/origin enforcement belongs to the official Connection fetch carrier. */
export async function apply(ctx) {
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))
  const domain = await ctx.storageDomain.open(domainSpec)
  let disposed = false, settingsUrl
  const store = createSettingsStore(ctx.settings, name)
  const settings = store.read, saveSettings = store.save
  const host = createResidentHost({ ctx, settings, saveSettings, binding: domain.global, deviceFactory: openDesktopDevice, speech: optionalNativeSpeech(ctx), pet: optionalPetPresenter(ctx),
    credentials: createSpeechCredentials(ctx.credentials, credentialKey),
    installTools: agent => installNativeManagement({ ctx, agent, settings, ledger: domain.table('requests'), defineTool }),
    openSettings: () => { if (!settingsUrl) throw Error('ASSISTANT_SETTINGS_URL_UNAVAILABLE'); return host.openSettings(settingsUrl) },
  })
  const unregister = ctx.connection.fetch.register({ path: '/api/voice-assistant', methods: ['GET','POST'], requestBody: 'buffered',
    async fetch(request) {
      if (disposed) return json({ error: 'ASSISTANT_CLOSED' }, 503)
      const url = new URL(request.url)
      if (['localhost','127.0.0.1','[::1]'].includes(url.hostname) && ['http:','https:'].includes(url.protocol)) settingsUrl = url.origin + '/?voice-assistant=1'
      try { return json(request.method === 'GET' ? await host.state() : await host.command(await readCommand(request))) }
      catch (error) { return json({ error: /^[A-Z][A-Z0-9_]{1,100}$/.test(error?.message) ? error.message : 'ASSISTANT_OPERATION_FAILED' }, 400) }
    },
  })
  ctx.effect(() => async () => { disposed = true; await unregister(); await host.dispose(); await store.close(); await domain.close() })
}
