import z from '@deepseek-ai/schemastery'

/** Explicit desktop capture policy and separately configured assistant preset. */
export const SettingsSchema = z.object({
  agentPreset: z.string().default(''),
  silenceThreshold: z.number().min(0.001).max(1).default(0.01),
  silenceDurationMs: z.number().step(1).min(200).max(10000).default(1000),
  sampleMs: z.number().step(1).min(10).max(1000).default(50),
  maxVisibleMessages: z.number().step(1).min(1).max(1000).default(100),
})
export const Config = SettingsSchema.volatile().default({})
