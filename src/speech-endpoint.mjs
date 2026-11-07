/** Shared settings/credential boundary; URLs cannot embed credentials or forward keys through redirects. */
export function speechEndpoint(endpoint) {
  let url
  try { url = new URL(endpoint) } catch { throw Error('SPEECH_ENDPOINT_INVALID') }
  if (url.username || url.password || url.search || url.hash || !['https:','http:'].includes(url.protocol)) throw Error('SPEECH_ENDPOINT_INVALID')
  if (url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw Error('SPEECH_ENDPOINT_REQUIRES_TLS')
  return url.href
}
