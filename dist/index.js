// src/settings.mjs
import z from "@deepseek-ai/schemastery";
var SettingsSchema = z.object({
  agentPreset: z.string().default(""),
  silenceThreshold: z.number().min(1e-3).max(1).default(0.01),
  silenceDurationMs: z.number().step(1).min(200).max(1e4).default(1e3),
  sampleMs: z.number().step(1).min(10).max(1e3).default(50),
  maxVisibleMessages: z.number().step(1).min(1).max(1e3).default(100)
});
var Config = SettingsSchema.volatile().default({});

// src/index.mjs
var name = "dsh-voice-assistant";
var inject = ["settings"];
function apply(ctx) {
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber));
}
export {
  Config,
  SettingsSchema,
  apply,
  inject,
  name
};
