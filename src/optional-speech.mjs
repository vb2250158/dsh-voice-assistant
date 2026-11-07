/** Optional native service lease. Missing/unloaded ASR never unloads text management. */
export function optionalNativeSpeech(ctx) {
  let current
  ctx.inject(['speechController'], scope => {
    const lease = { service: scope.speechController }
    current = lease
    scope.effect(() => () => { if (current === lease) current = undefined })
  })
  return () => current?.service
}
