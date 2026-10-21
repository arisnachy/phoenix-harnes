/**
 * Default model selection for an Agent without a session-specific selection.
 *
 * @module @phoenix-ai/dsh-agent-default-model
 */

import { Context, Service } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type { ModelSelection, EclipseRoutingSettings } from '@phoenix-ai/dsh-agent'
import { ReasoningEffortId } from '@phoenix-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@phoenix-ai/dsh-settings'

declare module '@phoenix-ai/cordis' {
  interface Context {
    /** Default model selection for Agents created without an explicit model. */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/** Settings namespace carrying the default model selection for future Agents. */
export const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = settingsNamespace('agent-default-model')

/** Fénix Eclipse owns an independent, model-specific settings namespace. */
export const ECLIPSE_ROUTING_SETTINGS_NAMESPACE = settingsNamespace('eclipse-routing')

/** Provider-native runtime selection and exact last picker choice are independent. */
export interface LastPickerSelection {
  /** Registered provider (or provider that owns a virtual picker model). */
  provider: string
  /** Exact user-facing selected model, including Fénix Eclipse. */
  model: string
  /** Selected effort, when managed explicitly by the picker. */
  reasoningEffort?: string
  /** Provider-native route this picker choice corresponded to. */
  runtimeProvider: string
  /** Provider-native model id (never the synthetic Eclipse selector). */
  runtimeModel: string
  /** Native reasoning effort, if any. */
  runtimeReasoningEffort?: string
}

/** Stored and composed default model selection. */
export interface AgentDefaultModelSettings {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
  /** Eclipse orchestration preferences, never interpreted as a model id. */
  eclipse?: EclipseRoutingSettings
  /** Most recently accepted Web picker choice, kept separate from the executable route. */
  lastPickerSelection?: LastPickerSelection
}

const eclipseRouteSchema = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
})

/** Independent route configuration for the synthetic Fénix Eclipse model. */
export const ECLIPSE_ROUTING_SETTINGS_SCHEMA: z<EclipseRoutingSettings> = z.object({
  mode: z.union(['automatic', 'hybrid', 'manual']),
  planner: eclipseRouteSchema,
  coordinator: eclipseRouteSchema,
  subagent: eclipseRouteSchema,
  specialists: z.dict(eclipseRouteSchema),
  maxTeammates: z.number().step(1).min(0).max(3),
})

/** Schema of the default Agent model settings section. */
export const AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA: z<AgentDefaultModelSettings> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
  lastPickerSelection: z.object({
    provider: z.string().required(),
    model: z.string().required(),
    reasoningEffort: z.string(),
    runtimeProvider: z.string().required(),
    runtimeModel: z.string().required(),
    runtimeReasoningEffort: z.string(),
  }),
  eclipse: z.object({
    mode: z.union(['automatic', 'hybrid', 'manual']).default('automatic'),
    planner: eclipseRouteSchema,
    coordinator: eclipseRouteSchema,
    subagent: eclipseRouteSchema,
    specialists: z.dict(eclipseRouteSchema),
    maxTeammates: z.number().step(1).min(0).max(3),
  }),
})

/** Composition entry for the default model selection. */
export interface Config {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** Project stored settings onto the Agent-facing selection type. */
function selection(settings: AgentDefaultModelSettings): ModelSelection {
  return {
    provider: settings.provider,
    model: settings.model,
    ...settings.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(settings.reasoningEffort) },
  }
}

/**
 * Owns the default model selection independently of any Host or transport.
 * The composition entry remains usable without a settings provider; when one
 * is mounted, its user layer is read live.
 */
export class AgentDefaultModelConfig extends Service {
  static Config: z<Config> = z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })

  private source: () => AgentDefaultModelSettings
  private eclipseSource: () => EclipseRoutingSettings = () => ({})

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentDefaultModel')
    const entry: AgentDefaultModelSettings = { provider: config.provider, model: config.model }
    this.source = () => entry
    installSettingsSection(ctx, AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA, entry, {
      setSource: (current) => { this.source = current },
      // Every consumer reads through currentSelection(), so no registration-level fact
      // needs rebuilding when the settings document changes.
      onChange: () => {},
    })
    // Eclipse is configured by its own synthetic-model section, not by
    // the regular Agent default model. Preserve legacy saved values until the
    // user first saves a dedicated Eclipse preference.
    installSettingsSection(ctx, ECLIPSE_ROUTING_SETTINGS_NAMESPACE, ECLIPSE_ROUTING_SETTINGS_SCHEMA, {}, {
      setSource: (current) => { this.eclipseSource = current },
      onChange: () => {},
    })
  }

  /**
   * Read the current default model selection.
   * @returns a detached provider, model, and optional reasoning selection.
   */
  currentSelection(): ModelSelection {
    return selection(this.source())
  }

  /** Recover the last picker model for a new, otherwise blank conversation.
   * @returns Last saved picker selection, or the provider-native default.
   */
  preferredSelection(): ModelSelection {
    const latest = this.source().lastPickerSelection
    if (latest === undefined) return this.currentSelection()
    const runtime = this.currentSelection()
    if (latest.runtimeProvider !== runtime.provider || latest.runtimeModel !== runtime.model
      || (latest.runtimeReasoningEffort ?? '') !== String(runtime.reasoningEffort ?? '')) {
      return runtime
    }
    return {
      provider: latest.provider,
      model: latest.model,
      ...latest.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(latest.reasoningEffort) },
    }
  }

  /**
   * Save the complete default model selection. A deployment without a settings
   * provider keeps its composition entry.
   * @param next - resolved selection accepted by an entry point.
   * @returns fulfillment after the optional settings write settles.
   */
  /** Resolve Eclipse settings live so a saved change affects the next model request.
   * @returns Detached Eclipse settings, or undefined when no user overrides exist.
   */
  currentEclipseProfile(): EclipseRoutingSettings | undefined {
    const dedicated = this.eclipseSource()
    if (Object.keys(dedicated).length !== 0) return structuredClone(dedicated)
    // Non-destructive compatibility with Eclipse settings saved before this
    // namespace existed. All new writes target eclipse-routing exclusively.
    const legacy = this.source().eclipse
    return legacy === undefined ? undefined : structuredClone(legacy)
  }

  /** Persist the accepted Web picker identity and native execution route atomically.
   * @param selected - Exact model the user last chose in the picker.
   * @param runtime - Validated provider-native execution route (never a synthetic model).
   * @returns Persistence completion; failures must not be described as saved.
   */
  async saveWebSelection(selected: ModelSelection, runtime: ModelSelection): Promise<void> {
    const settings = this.ctx.get('settings')
    if (settings === undefined) throw new Error('Phoenix settings provider is unavailable; model was not saved')
    const current = this.source()
    await settings.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      provider: runtime.provider,
      model: runtime.model,
      ...runtime.reasoningEffort === undefined ? {} : { reasoningEffort: String(runtime.reasoningEffort) },
      lastPickerSelection: {
        provider: selected.provider,
        model: selected.model,
        ...selected.reasoningEffort === undefined ? {} : { reasoningEffort: String(selected.reasoningEffort) },
        runtimeProvider: runtime.provider,
        runtimeModel: runtime.model,
        ...runtime.reasoningEffort === undefined ? {} : { runtimeReasoningEffort: String(runtime.reasoningEffort) },
      },
      ...current.eclipse === undefined ? {} : { eclipse: current.eclipse },
    })
  }

  /** Persist a new model default without erasing user-owned Eclipse configuration.
   * @param next - Selected default provider, model and optional reasoning.
   * @returns Completion after the settings write.
   */
  async saveSelection(next: ModelSelection): Promise<void> {
    await this.ctx.get('settings')?.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      provider: next.provider,
      model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
      ...this.source().eclipse === undefined ? {} : { eclipse: this.source().eclipse },
      ...this.source().lastPickerSelection === undefined ? {} : { lastPickerSelection: this.source().lastPickerSelection },
    })
  }
}

export default AgentDefaultModelConfig
