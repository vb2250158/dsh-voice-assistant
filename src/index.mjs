export { Config, SettingsSchema } from './settings.mjs'
export const name = 'dsh-voice-assistant'
export const inject = ['settings']

/** Publish the assistant configuration through the standard settings service. */
export function apply(ctx) {
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))
}
