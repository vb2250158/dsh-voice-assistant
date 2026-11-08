import z from '@deepseek-ai/schemastery'
import { validateProviderEndpoint } from '@rabilink/desktop-voice-service/provider-profiles'
import { speechParameterDefinitions, speechSelectionDefinitions } from '@rabilink/desktop-voice-service/speech-catalog'
export const defaultPersona = `你是大肥鱼，也叫 DeepSeek 娘，是陪用户聊天、把事情办好的语音助手。
说话自然、聪明松弛，像熟悉的伙伴。偶尔嘴硬、开个轻巧的玩笑，喜欢寻找省力而可靠的办法；认真办事时清楚、负责，不用“摸鱼”推脱工作。
优先用适合朗读的短句。先回应当前问题，必要时再解释；不把每次聊天都变成汇报，也不反复追问已经明确的要求。
不知道就明确说不知道，出错要承认并修复。只根据真实执行结果汇报，不编造已完成、正在监听或已经发送。
人设风格不改变工具权限、目标身份和执行规则。`
const speechDefinitions = { ...speechParameterDefinitions, ...speechSelectionDefinitions }
const speechFields = Object.fromEntries(Object.entries(speechDefinitions).map(([key, spec]) => {
  let field
  if (spec.enum) field = z.union(spec.enum)
  else if (typeof spec.default === 'boolean') field = z.boolean()
  else if (typeof spec.default === 'number') {
    field = z.number()
    if (spec.min !== undefined) field = field.min(spec.min)
    if (spec.max !== undefined) field = field.max(spec.max)
    if (spec.integer) field = field.step(1)
  } else if (typeof spec.default === 'string') field = z.string()
  else throw Error('ASSISTANT_SPEECH_DEFINITION_INVALID')
  return [key, field.default(spec.default)]
}))
export const ResidentSettingsSchema = z.object({
  ...speechFields,
  persona: z.string().default(defaultPersona), agentPreset: z.string().default(''), cwd: z.string().default(''),
  manageAllWorkspaces: z.boolean().default(true), electronExecutable: z.string().default(''),
  asrMode: z.string().default('native'), asrProviderId: z.string().default(''), asrResourceId: z.string().default(''),
  ttsProvider: z.string().default('compatible'), ttsResourceId: z.string().default(''), speechProfiles: z.dict(z.dict(z.dict(z.union([z.string(), z.number(), z.boolean()])))).default({}),
  asrEndpoint: z.string().default('https://api.openai.com/v1/audio/transcriptions'), asrModel: z.string().default(''),
  ttsEndpoint: z.string().default('https://api.openai.com/v1/audio/speech'), ttsModel: z.string().default(''), ttsVoice: z.string().default(''),
  inputDeviceId: z.string().default(''), outputDeviceId: z.string().default(''),
  silenceThreshold: z.number().min(.001).max(1).default(.01), silenceDurationMs: z.number().min(200).max(10000).default(700),
  sampleMs: z.number().min(10).max(1000).default(50), outputEnabled: z.boolean().default(true),
  captionsEnabled: z.boolean().default(true), captionLocked: z.boolean().default(false), captionSkin: z.string().default('dark'),
  captionFontSize: z.number().min(16).max(48).default(24), captionOpacity: z.number().min(.15).max(1).default(.85),
  captionPosition: z.string().default('bottom'),
  captionX: z.number().default(0), captionY: z.number().default(0), captionWidth: z.number().min(320).max(4096).default(720),
  captionHeight: z.number().min(100).max(2048).default(150), captionHasBounds: z.boolean().default(false),
  petEnabled: z.boolean().default(false), petId: z.string().default(''), petBubbles: z.boolean().default(true), petAnimation: z.boolean().default(true),
})
export function validateResidentSettings(value) {
  const config = ResidentSettingsSchema(value)
  if (!['native','compatible','volcengine'].includes(config.asrMode) || !['compatible','volcengine'].includes(config.ttsProvider) || !['light','dark'].includes(config.captionSkin)
    || !['top','bottom'].includes(config.captionPosition) || config.persona.length > 16000 || config.petId.length > 128) throw Error('ASSISTANT_SETTINGS_INVALID')
  for (const [key, spec] of Object.entries(speechDefinitions)) {
    const value = config[key]
    if (typeof value !== typeof spec.default || spec.enum && !spec.enum.includes(value)
      || typeof value === 'string' && value.length > (spec.max ?? 2048)
      || typeof value === 'number' && (!Number.isFinite(value) || spec.integer && !Number.isInteger(value)
        || value < (spec.min ?? -1e7) || value > (spec.max ?? 1e7))) throw Error('ASSISTANT_SETTINGS_INVALID')
  }
  if (config.asrMode !== 'native') validateProviderEndpoint(config.asrEndpoint, config.asrMode)
  validateProviderEndpoint(config.ttsEndpoint, config.ttsProvider)
  return config
}
