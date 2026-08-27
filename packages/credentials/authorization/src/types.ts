/**
 * Wire-safe authorization types, free of cordis/service imports so browser type
 * chains (apiproxy api → client) can consume them without loading this
 * package's Context augmentation.
 * @module @deepseek-ai/dsh-authorization/types
 */

import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'

/** One way a flow can obtain its credential, named by the flow that offers it. */
export interface AuthorizationMethod {
  /** Flow-owned identifier, echoed back when a caller picks this method. */
  id: string
  /** User-facing label for a picker. */
  label: string
}

/** A running flow's report to whoever is watching it. Never carries a secret. */
export interface AuthorizationNotice {
  /** What is happening, or what the human must do next. */
  message: string
  /** A page the human must open to continue. */
  url?: string
  /** A short code the human must enter on that page. */
  code?: string
}

/** One choice offered by a `select` prompt. */
export interface AuthorizationPromptOption {
  /** Value returned when this option is chosen. */
  id: string
  /** User-facing label. */
  label: string
  /** Optional extra context rendered by capable surfaces. */
  description?: string
}

/**
 * A question a flow must have answered before it can continue. `secret` differs
 * from `text` only in presentation — a surface masks it and keeps it out of
 * logs — and `select` answers with the chosen option's `id`.
 */
export type AuthorizationPrompt = {
  /**
   * Withdraws this prompt alone, leaving the flow running. A flow that races a
   * typed code against a browser callback aborts the losing prompt here; the
   * whole authorization is cancelled through the request's signal instead.
   */
  signal?: AbortSignal
} & ({
  kind: 'text'
  message: string
  placeholder?: string
} | {
  kind: 'secret'
  message: string
  placeholder?: string
} | {
  kind: 'select'
  message: string
  options: readonly AuthorizationPromptOption[]
})

/** How one authorization attempt ended, as its own caller sees it. */
export type AuthorizationStatus = 'authorized' | 'cancelled'

/**
 * How one attempt ended, as an onlooker sees it. A failure reaches its caller
 * as a thrown error rather than an outcome, so `failed` exists only here — on
 * the event stream, where a watcher that did not start the attempt has no
 * other way to tell a refusal from a breakage.
 */
export type AuthorizationSettlement = AuthorizationStatus | 'failed'

/** The result of one `begin()` attempt. */
export interface AuthorizationOutcome {
  /** `authorized` once the record is committed and observed; `cancelled` when the human or caller withdrew. */
  status: AuthorizationStatus
}

/** One provider-reported quota window. Percentages are 0..100. */
export interface AuthorizationRateLimitWindow {
  usedPercent: number
  /** Duration of the provider window when it exposes one. */
  windowDurationMins?: number
  /** Unix timestamp in seconds when the window resets. */
  resetsAt?: number
}

/** Public credit facts. No credential or billing instrument is represented. */
export interface AuthorizationCreditsTelemetry {
  hasCredits: boolean
  unlimited: boolean
  /** Provider-formatted non-secret balance, when supplied. */
  balance?: string
}

/** Secret-free token-activity summary suitable for an account card. */
export interface AuthorizationUsageTelemetry {
  lifetimeTokens?: number
  peakDailyTokens?: number
  longestRunningTurnSec?: number
  currentStreakDays?: number
  longestStreakDays?: number
}

/**
 * Secret-free connector/app metadata suitable for a settings card. The shape
 * is deliberately closed: upstream connector auth/session payloads never cross
 * the authorization boundary.
 */
export interface AuthorizationConnectorTelemetry {
  id: string
  name: string
  description?: string
  iconUrl?: string
  iconUrlDark?: string
  category?: string
  installUrl?: string
  accessible: boolean
  enabled: boolean
  /** Present only when the provider exposes an authoritative installed snapshot. */
  installed?: boolean
  /** Present only when the provider reports whether a model-visible tool is callable. */
  callable?: boolean
}

/**
 * Sanitized optional account telemetry a flow may expose after authentication.
 * This contract deliberately has no arbitrary JSON escape hatch: adding a new
 * field requires code review, preventing an upstream token/session object from
 * accidentally crossing into the browser.
 */
export interface AuthorizationAccountTelemetry {
  kind: 'account'
  /** Product/provider that owns the native account session. */
  provider: string
  /** Provider account family, for example `chatgpt` or `apiKey`. */
  accountType?: string
  email?: string
  plan?: string
  primaryLimit?: AuthorizationRateLimitWindow
  secondaryLimit?: AuthorizationRateLimitWindow
  credits?: AuthorizationCreditsTelemetry
  usage?: AuthorizationUsageTelemetry
  /** Optional provider-native connector catalog, already sanitized. */
  connectors?: readonly AuthorizationConnectorTelemetry[]
}

/** Fixed, secret-free telemetry schema exposed by an authorization flow. */
export type AuthorizationTelemetry = AuthorizationAccountTelemetry

/** A registered flow as a surface sees it: what it authorizes and whether it is busy. */
export interface AuthorizationEntry {
  /** The credential record this flow writes. */
  key: CredentialKey
  /** User-facing name of what is being authorized. */
  label: string
  /** The methods this flow offers, most preferred first. */
  methods: readonly AuthorizationMethod[]
  /** Whether an attempt for this key is running right now. */
  inFlight: boolean
  /** Present only when the owner can revoke/logout this account through the same seam. */
  disconnectable?: true
}
