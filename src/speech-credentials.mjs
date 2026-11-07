import { createHash } from 'node:crypto'
import { speechEndpoint } from './speech-endpoint.mjs'
/** Endpoint-bound plugin credentials. Editing a URL cannot forward its old key to another service. */
export function createSpeechCredentials(credentials, credentialKey) {
  const address = (kind, endpoint) => {
    if (!['asr','tts'].includes(kind)) throw Error('SPEECH_CREDENTIAL_KIND_INVALID')
    return credentialKey('dsh-voice-assistant', kind + '-' + createHash('sha256').update(speechEndpoint(endpoint)).digest('hex'))
  }
  return {
    async describe(kind, endpoint) { return credentials.describeRecord(address(kind, endpoint)) },
    async resolve(kind, endpoint) {
      const record = await credentials.readRecord(address(kind, endpoint))
      return record?.kind === 'api-key' ? record.key : undefined
    },
    async set(kind, endpoint, key) {
      if (typeof key !== 'string' || key.length > 8192 || /[\r\n]/.test(key)) throw Error('SPEECH_CREDENTIAL_INVALID')
      const target = address(kind, endpoint)
      if (!key) await credentials.deleteRecord(target)
      else await credentials.modifyRecord(target, async () => ({ kind: 'api-key', key }))
      return credentials.describeRecord(target)
    },
  }
}
