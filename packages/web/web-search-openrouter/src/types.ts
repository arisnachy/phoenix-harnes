/** Minimal OpenRouter Chat Completions response shapes used by web search. */

export interface OpenRouterUrlCitation {
  readonly type: 'url_citation'
  readonly url_citation: {
    readonly url: string
    readonly title?: string
    readonly content?: string
  }
}

/** Minimal successful Chat Completions response consumed by the search provider. */
export interface OpenRouterSearchResponse {
  readonly choices?: ReadonlyArray<{
    readonly message?: {
      readonly content?: string | null
      readonly annotations?: readonly OpenRouterUrlCitation[]
    }
  }>
}

/** Minimal OpenRouter error envelope used for safe user-facing diagnostics. */
export interface OpenRouterErrorResponse {
  readonly error?: string | { readonly message?: string }
  readonly message?: string
}
