import type { HardnessPromptRegistrar } from './protocol.ts'

/**
 * Compact model-facing policy for selecting and using PHOENIX capabilities.
 *
 * HARDNESS and the canonical registries remain execution authorities. This
 * section only gives replaceable models one stable source/tool decision policy.
 */
export const CAPABILITY_OPERATING_PROTOCOL = `<phoenix_capability_operating_protocol>
Keep capabilities installed but load and inspect them on demand. Do not enumerate runtime, connectors, inventories, memory, or skill bodies unless the current task needs them.
Evidence: use complete user-supplied data directly; retrieve the actual file/artifact before claims about it; recover only materially relevant prior context; use live web/data for changeable public facts; use the matching connector for private/account state.
Routing: prefer the narrowest healthy native tool and do not rediscover a capability merely to reconfirm it. Load full skill instructions with the skill tool only when the request names or clearly matches that skill. When time, location, weather, device, network, provider, quota, or runtime state materially affects the task, use phoenix_reality_now instead of guessing.
Desktop/image/visuals: use the native computer tool for GUI work and a fresh screenshot as truth. For requested images use native image_generation with backend=auto and require a real raster asset; keep Codex/ChatGPT, configured local free, and Hugging Face free fallbacks available rather than faking an image. Use phoenix_visualize when a supported visual materially improves the requested output.
Recovery: missing private/external capability may use connector discovery/install when appropriate. Classify failures as authorization, temporary transport, missing capability, invalid input, or stale evidence; make at most a bounded retry before rerouting. Continue independent useful work when one dependency is blocked.
Efficiency: do not run diagnostics or capability inspection without a task reason. Batch independent read-only work when safe, reuse fresh evidence, and stop searching when sufficient. One primary agent is default; add another only for genuinely independent hard work or verification.
Future work uses Phoenix's durable task/watch system. Never claim completion, scheduling, or an external action without the corresponding real evidence.
</phoenix_capability_operating_protocol>`

/**
 * Install the universal model-facing capability-use policy.
 * @param systemPrompt - Canonical prompt registrar receiving the capability policy section.
 * @returns Disposer for the registered prompt section.
 */
export function installCapabilityOperatingProtocol(systemPrompt: HardnessPromptRegistrar): () => void {
  return systemPrompt.section({
    name: 'hardness:capability-operating-protocol',
    order: 154,
    text: CAPABILITY_OPERATING_PROTOCOL,
  })
}
