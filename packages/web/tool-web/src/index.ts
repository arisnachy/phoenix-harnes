/**
 * Model-facing `web_search` and `web_fetch` tools over `ctx.web`. This package owns schemas,
 * validation, prompt guidance, limits, and presentation, never concrete providers. Enablement
 * controls tool registration; an enabled tool remains visible when its provider is unavailable
 * and fails with a structured error at execution time.
 * @module @phoenix-ai/dsh-tool-web
 */

import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type {} from '@phoenix-ai/dsh-web'
import { applyWebSearchTool, WEB_SEARCH_MAX_QUERIES, WEB_SEARCH_MAX_RESULTS } from './search.ts'
import { applyWebFetchTool } from './fetch.ts'
import { applyResearchTools } from './research.ts'
import { createScholarlySearchTool } from './scholarly.ts'
import { createFederatedScholarTool } from './federated-scholar.ts'
import { createResearchCatalogTool } from './research-source-catalog.ts'
import { createWorldBankHealthSeriesTool } from './health-series.ts'
import { createWebImageSearchTool } from './image-search.ts'

export { WEB_SEARCH_MAX_QUERIES, WEB_SEARCH_MAX_RESULTS, applyWebSearchTool, formatSearchOutput, presentSearchCall, presentSearchResult, searchMetaFromValue, searchMetaFromResult } from './search.ts'
export { createWebImageSearchTool, searchCommonsImages, projectCommonsImages, COMMONS_IMAGE_SEARCH_TIMEOUT_MS } from './image-search.ts'
export type { CommonsReferenceImage } from './image-search.ts'
export type { WebSearchMeta } from './search.ts'
export { applyWebFetchTool, formatFetchOutput, parseFetchArgs, presentFetchCall, presentFetchResult, fetchMetaFromValue, fetchMetaFromResult } from './fetch.ts'
export type { WebFetchMeta } from './fetch.ts'
export { RESEARCH_SOURCES, planResearch, executeResearch, applyResearchTools } from './research.ts'
export type { ResearchSource, ResearchPlan, ResearchOutcome } from './research.ts'
export { searchEuropePmc, projectEuropePmcRecords, createScholarlySearchTool } from './scholarly.ts'
export { searchFederatedScholar, projectFederatedRecords, createFederatedScholarTool, FEDERATED_SOURCES } from './federated-scholar.ts'
export type { FederatedRecord, FederatedSource, FederatedResponse } from './federated-scholar.ts'
export { RESEARCH_API_CATALOG, listResearchCatalog, createResearchCatalogTool } from './research-source-catalog.ts'
export type { ResearchCatalogEntry } from './research-source-catalog.ts'
export type { ScholarlyRecord } from './scholarly.ts'
export { fetchWorldBankHealthSeries, createWorldBankHealthSeriesTool, HEALTH_INDICATORS } from './health-series.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-web'

/** Services required by the web tool suite. */
export const inject = ['tools', 'web', 'systemPrompt']

/** Default cooperative tool-call timeout budget (ms) for the web tools. */
export const DEFAULT_WEB_TOOL_TIMEOUT_MS = 30_000

/**
 * Default cap on one `web_fetch` output and on source characters converted
 * synchronously. This leaves headroom above the local provider's default
 * 100,000-character body cap while bounding custom providers and rendered output.
 */
export const DEFAULT_FETCH_MAX_OUTPUT_CHARS = 200_000

/** Plugin config: which web tools to register, search bounds, per-tool budgets, and the fetch output cap. */
export interface Config {
  /** Register `web_search`. Defaults to true. */
  search?: boolean
  /** Register `web_fetch`. Defaults to true. */
  fetch?: boolean
  /** Upper bound on sources returned by one `web_search` call. */
  searchMaxResults?: number
  /** Upper bound on queries accepted by one `web_search` call. */
  searchMaxQueries?: number
  /** Cooperative timeout budget (ms) for `web_fetch`. Defaults to 30000. */
  fetchTimeoutMs?: number
  /** Cooperative timeout budget (ms) for `web_search`. Defaults to 30000. */
  searchTimeoutMs?: number
  /** Cap on source characters converted and complete `web_fetch` output characters. Defaults to 200000. */
  fetchMaxOutputChars?: number
}

export const Config: z<Config> = z.object({
  search: z.boolean().default(true),
  fetch: z.boolean().default(true),
  searchMaxResults: z.number().default(WEB_SEARCH_MAX_RESULTS),
  searchMaxQueries: z.number().default(WEB_SEARCH_MAX_QUERIES),
  fetchTimeoutMs: z.number().default(DEFAULT_WEB_TOOL_TIMEOUT_MS),
  searchTimeoutMs: z.number().default(DEFAULT_WEB_TOOL_TIMEOUT_MS),
  fetchMaxOutputChars: z.number().default(DEFAULT_FETCH_MAX_OUTPUT_CHARS),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/** Configured count, timeout, and character caps must be positive integers. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-web: ${name} must be a positive integer`)
  }
}

/**
 * Register the enabled web tools. `search`/`fetch` default to true; a product
 * that wants only one disables the other in config. Each tool's cooperative
 * timeout budget (`fetchTimeoutMs`/`searchTimeoutMs`, default 30000) is resolved
 * here and attached to the tool as `ToolDefinition.timeoutMs` for
 * `@phoenix-ai/dsh-tool-call-timeout-policy` to enforce. The tools' disposers are
 * fiber-scoped (the effect-based registries clean up on dispose), so no manual
 * teardown is needed.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertPositiveInteger('searchMaxResults', resolved.searchMaxResults)
  assertPositiveInteger('searchMaxQueries', resolved.searchMaxQueries)
  assertPositiveInteger('fetchTimeoutMs', resolved.fetchTimeoutMs)
  assertPositiveInteger('searchTimeoutMs', resolved.searchTimeoutMs)
  assertPositiveInteger('fetchMaxOutputChars', resolved.fetchMaxOutputChars)
  if (resolved.search) {
    applyWebSearchTool(ctx, resolved.searchMaxResults, resolved.searchMaxQueries, resolved.searchTimeoutMs, resolved.fetch)
    applyResearchTools(ctx, resolved.searchMaxResults, resolved.searchTimeoutMs)
    ctx.tools.register(createScholarlySearchTool())
    ctx.tools.register(createFederatedScholarTool())
    ctx.tools.register(createResearchCatalogTool())
    ctx.systemPrompt.section({
      name: 'tool:research_federated', order: 113,
      text: 'Para investigación científica de cualquier disciplina, buscar evidencia bibliográfica en research_federated (fuentes paralelas y fallos explícitos), combinar con research_catalog para datos primarios especializados y research_investigate para lectura real. Verificar DOI, texto completo, fecha, retractaciones, diseño y calidad metodológica antes de citar conclusiones. Metadatos de búsqueda no equivalen a evidencia verificada ni ofrecen acceso al texto completo.',
    })
    ctx.tools.register(createWorldBankHealthSeriesTool())
    ctx.tools.register(createWebImageSearchTool())
    ctx.systemPrompt.section({
      name: 'tool:web_image_search', order: 114,
      text: 'Cuando una interfaz inteligente necesita referencias visuales existentes, busca primero con web_image_search y coloca los resultados reales como nodos reference_image de ui_canvas (src, alt, sourceUrl, credit, license y licenseUrl). Mantén crédito y licencia visibles, no inventes URLs ni imágenes ni uses la búsqueda textual como si devolviera miniaturas. Esta vía tiene presupuesto de 8 segundos para consultar Wikimedia Commons; no garantiza el tiempo de descarga. Para una imagen original o modificación de una foto, usa image_generation y comunica los tiempos reales.',
    })
  }
  if (resolved.fetch) applyWebFetchTool(ctx, resolved.fetchTimeoutMs, resolved.fetchMaxOutputChars)
}
