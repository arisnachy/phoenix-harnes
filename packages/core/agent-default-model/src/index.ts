/**
 * Default model selection for an Agent without a session-specific selection.
 *
 * @module @phoenix-ai/dsh-agent-default-model
 */

import { Context, Service } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type { ModelSelection } from '@phoenix-ai/dsh-agent'
import { ReasoningEffortId } from '@phoenix-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@phoenix-ai/dsh-settings'

declare module '@phoenix-ai/cordis' {
  interface Context {
    /** Default model selection for Agents created without an explicit model. */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/** Settings namespace carrying the provider-native default for future Agents. */
export const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = settingsNamespace('agent-default-model')
/** Separate picker-intent namespace; older runtimes safely ignore this namespace. */
export const UI_MODEL_SELECTION_SETTINGS_NAMESPACE = settingsNamespace('ui-model-selection')
/** Keep recent per-session picker intent bounded in user settings. */
export const UI_MODEL_SELECTION_HISTORY_LIMIT = 64

/** Stored and composed default model selection. */
export interface AgentDefaultModelSettings {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
}

/**
 * One browser/session picker choice paired with the provider-native route that
 * actually executes it. The split lets virtual choices such as Phoenix Auto
 * survive reloads without leaking synthetic model ids into direct/headless
 * Agent entry points.
 */
export interface UiModelSelectionRecord {
  /** Session whose picker owns this explicit choice. */
  sessionId: string
  /** User-facing selected provider. */
  provider: string
  /** User-facing selected model id (may be a virtual selector id). */
  model: string
  /** User-facing effort, absent when the selector owns effort automatically. */
  reasoningEffort?: string
  /** Provider-native route used by Agent/delegator runtime state. */
  runtimeProvider: string
  /** Provider-native runtime model id. */
  runtimeModel: string
  /** Provider-native runtime effort, when any. */
  runtimeReasoningEffort?: string
}

/** Durable picker history stored outside the Agent runtime-default namespace. */
export interface UiModelSelectionSettings {
  /** Most-recent record is last; bounded by {@link UI_MODEL_SELECTION_HISTORY_LIMIT}. */
  selections: UiModelSelectionRecord[]
}

/** Detached picker + runtime pair returned to the Web gateway. */
export interface SessionModelSelectionPreference {
  /** Exact user-facing picker choice. */
  selected: ModelSelection
  /** Real provider route synchronized into the Agent. */
  runtime: ModelSelection
}

/** Schema of the default Agent model settings section. */
export const AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA: z<AgentDefaultModelSettings> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
})

const UI_MODEL_SELECTION_RECORD_SCHEMA: z<UiModelSelectionRecord> = z.object({
  sessionId: z.string().required(),
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
  runtimeProvider: z.string().required(),
  runtimeModel: z.string().required(),
  runtimeReasoningEffort: z.string(),
})

/** Schema for browser/session picker intent. */
export const UI_MODEL_SELECTION_SETTINGS_SCHEMA: z<UiModelSelectionSettings> = z.object({
  selections: z.array(UI_MODEL_SELECTION_RECORD_SCHEMA).default([]),
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

function selectedFromRecord(record: UiModelSelectionRecord): ModelSelection {
  return {
    provider: record.provider,
    model: record.model,
    ...record.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(record.reasoningEffort) },
  }
}

function runtimeFromRecord(record: UiModelSelectionRecord): ModelSelection {
  return {
    provider: record.runtimeProvider,
    model: record.runtimeModel,
    ...record.runtimeReasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(record.runtimeReasoningEffort) },
  }
}

function sameSelection(left: ModelSelection, right: ModelSelection): boolean {
  return left.provider === right.provider
    && left.model === right.model
    && String(left.reasoningEffort ?? '') === String(right.reasoningEffort ?? '')
}

function recordFor(
  sessionId: string,
  selected: ModelSelection,
  runtime: ModelSelection,
): UiModelSelectionRecord {
  return {
    sessionId,
    provider: selected.provider,
    model: selected.model,
    ...selected.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: String(selected.reasoningEffort) },
    runtimeProvider: runtime.provider,
    runtimeModel: runtime.model,
    ...runtime.reasoningEffort === undefined
      ? {}
      : { runtimeReasoningEffort: String(runtime.reasoningEffort) },
  }
}

/**
 * Owns the default model selection independently of any Host or transport.
 * Provider-native runtime defaults stay separate from browser picker intent,
 * so synthetic selectors never leak into direct/headless Agent creation.
 */
export class AgentDefaultModelConfig extends Service {
  static Config: z<Config> = z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })

  private source: () => AgentDefaultModelSettings
  private uiFallback: UiModelSelectionSettings = { selections: [] }
  private uiSource: () => UiModelSelectionSettings = () => this.uiFallback

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
    installSettingsSection(ctx, UI_MODEL_SELECTION_SETTINGS_NAMESPACE, UI_MODEL_SELECTION_SETTINGS_SCHEMA, this.uiFallback, {
      setSource: (current) => { this.uiSource = current },
      onChange: () => {},
    })
  }

  /**
   * Read the provider-native default model selection.
   * @returns a detached provider, model, and optional reasoning selection.
   */
  currentSelection(): ModelSelection {
    return selection(this.source())
  }

  /**
   * Read the last user-facing picker choice compatible with the current
   * provider-native default. New Web sessions use this so Phoenix Auto remains
   * Phoenix Auto in the selector while direct entry points keep the real route.
   * @returns last compatible picker choice, else the runtime default itself.
   */
  preferredSelection(): ModelSelection {
    const runtime = this.currentSelection()
    const records = this.uiSource().selections
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index]
      if (record !== undefined && sameSelection(runtimeFromRecord(record), runtime)) {
        return selectedFromRecord(record)
      }
    }
    return runtime
  }

  /**
   * Recover one session's explicit picker intent and backing runtime route.
   * @param sessionId - Session being resumed/reopened.
   * @returns stored pair when that session explicitly selected a model.
   */
  sessionSelection(sessionId: string): SessionModelSelectionPreference | undefined {
    const records = this.uiSource().selections
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index]
      if (record?.sessionId !== sessionId) continue
      return {
        selected: selectedFromRecord(record),
        runtime: runtimeFromRecord(record),
      }
    }
    return undefined
  }

  /**
   * Save the provider-native default model selection. A deployment without a
   * settings provider keeps its composition entry.
   * @param next - resolved selection accepted by an entry point.
   * @returns fulfillment after the optional settings write settles.
   */
  async saveSelection(next: ModelSelection): Promise<void> {
    await this.ctx.get('settings')?.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      provider: next.provider,
      model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
    })
  }

  /**
   * Persist one Web session's exact picker choice separately from the runtime
   * route. The history is bounded so long-lived installations do not grow
   * settings indefinitely.
   * @param sessionId - Session whose picker changed.
   * @param selected - Exact choice shown to the user.
   * @param runtime - Real provider-native route used by the Agent.
   * @returns fulfillment after the optional durable settings write settles.
   */
  async saveSessionSelection(
    sessionId: string,
    selected: ModelSelection,
    runtime: ModelSelection,
  ): Promise<void> {
    const current = this.uiSource().selections
    const next = [
      ...current.filter(record => record.sessionId !== sessionId),
      recordFor(sessionId, selected, runtime),
    ].slice(-UI_MODEL_SELECTION_HISTORY_LIMIT)
    this.uiFallback = { selections: next }
    await this.ctx.get('settings')?.replace(UI_MODEL_SELECTION_SETTINGS_NAMESPACE, {
      selections: next,
    })
  }
}

export default AgentDefaultModelConfig
