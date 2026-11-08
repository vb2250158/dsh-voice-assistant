import { createHash } from 'node:crypto'
import { speechEndpoint } from './speech-endpoint.mjs'
import { speechCredentialRef } from '@rabilink/desktop-voice-service/provider-profiles'
/** Endpoint-bound plugin credentials. Editing a URL cannot forward its old key to another service. */
export function createSpeechCredentials(credentials, credentialKey) {
  const address = (kind, endpoint, provider = 'compatible') => {
    if (!['asr','tts'].includes(kind)) throw Error('SPEECH_CREDENTIAL_KIND_INVALID')
    if (provider === 'compatible') return credentialKey('dsh-voice-assistant', kind + '-' + createHash('sha256').update(speechEndpoint(endpoint)).digest('hex'))
    return credentialKey('dsh-voice-assistant', kind + '-' + provider + '-' + createHash('sha256').update(speechCredentialRef(kind, provider, endpoint)).digest('hex'))
  }
  return {
    async describe(kind, endpoint, provider) { return credentials.describeRecord(address(kind, endpoint, provider)) },
    async resolve(kind, endpoint, provider) {
      const record = await credentials.readRecord(address(kind, endpoint, provider))
      return record?.kind === 'api-key' ? record.key : undefined
    },
    async set(kind, endpoint, key, provider) {
      if (typeof key !== 'string' || key.length > 8192 || /[\r\n]/.test(key)) throw Error('SPEECH_CREDENTIAL_INVALID')
      const target = address(kind, endpoint, provider)
      if (!key) await credentials.deleteRecord(target)
      else await credentials.modifyRecord(target, async () => ({ kind: 'api-key', key }))
      return credentials.describeRecord(target)
    },
  }
}
