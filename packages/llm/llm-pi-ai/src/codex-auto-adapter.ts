/**
 * Pi-ai adapter wrapper that refreshes the account-scoped Codex catalog at the
 * two points where stale model metadata matters: listing models for a selector
 * and retrying an exact model lookup that the current snapshot does not know.
 *
 * No timer is involved. Opening a model selector always asks Codex for its
 * current account catalog, while an already-open session naming a newly shipped
 * model gets one refresh-and-retry before the normal UNKNOWN_MODEL failure.
 *
 * @module dsh-llm-pi-ai/codex-auto-adapter
 */

import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@phoenix-ai/dsh-llm'
import { LlmError } from '@phoenix-ai/dsh-llm'
import { PiAiAdapter } from './adapter.ts'
import type { PiAiAdapterOptions } from './adapter.ts'
import { CODEX_PROVIDER } from './codex-live-catalog.ts'

/** Refresh callback owned by the plugin's live-catalog cache. */
export type CodexCatalogRefresh = (provider: string, signal?: AbortSignal) => Promise<void>

function isUnknownCodexModel(error: unknown, provider: string): boolean {
  return provider === CODEX_PROVIDER
    && error instanceof LlmError
    && error.code === 'UNKNOWN_MODEL'
}

/** Pi-ai adapter with automatic live Codex catalog recovery. */
export class CodexAutoRefreshingPiAiAdapter extends PiAiAdapter {
  constructor(
    options: PiAiAdapterOptions,
    private readonly refreshCatalog: CodexCatalogRefresh,
  ) {
    super(options)
  }

  /** A selector read is itself the freshness signal; refresh before listing. */
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    if (provider === CODEX_PROVIDER) await this.refreshCatalog(provider)
    return super.listModels(provider)
  }

  /** Refresh once when an exact Codex id is newer than the current snapshot. */
  override async resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    try {
      return await super.resolveModel(provider, model, signal)
    } catch (error: unknown) {
      if (!isUnknownCodexModel(error, provider)) throw error
      await this.refreshCatalog(provider, signal)
      return super.resolveModel(provider, model, signal)
    }
  }

  /** Bind preparation to the refreshed generation after one unknown-id miss. */
  override async prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<PreparedAdapterCall> {
    try {
      return await super.prepareCall(provider, model, signal)
    } catch (error: unknown) {
      if (!isUnknownCodexModel(error, provider)) throw error
      await this.refreshCatalog(provider, signal)
      return super.prepareCall(provider, model, signal)
    }
  }

  /** Direct adapter callers get the same one-refresh recovery as prepareCall. */
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    try {
      yield* super.stream(options)
    } catch (error: unknown) {
      if (!isUnknownCodexModel(error, options.provider)) throw error
      await this.refreshCatalog(options.provider, options.signal)
      yield* super.stream(options)
    }
  }
}
