/**
 * Browser-facing authorization domain. The host owns the interaction with
 * `ctx.authorization`; this API keeps an attempt alive while the browser
 * renders notices and answers prompts over separate requests.
 */

import type { AuthorizationNotice, AuthorizationPromptOption } from '@deepseek-ai/dsh-authorization/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** A prompt with its signal removed before it crosses the wire. */
export type AuthorizationPromptView = {
  kind: 'text' | 'secret'
  message: string
  placeholder?: string
} | {
  kind: 'select'
  message: string
  options: AuthorizationPromptOption[]
}

/** One notice emitted by a running authorization flow. */
export interface AuthorizationNoticeView {
  /** Monotonic cursor used by status polling to avoid replaying old notices. */
  seq: number
  notice: AuthorizationNotice
}

/** Presence facts for the record behind a flow, safe for configuration UIs — never a value. */
export interface AuthorizationStoredView {
  /** Discriminant of the stored record; absent while none is stored. */
  kind: 'api-key' | 'grant'
}

/** Wire-safe projection of a registered flow (the credential key brand is host-only). */
export interface AuthorizationEntryView {
  key: string
  label: string
  methods: AuthorizationMethodView[]
  inFlight: boolean
  /** The credential record behind the flow, when one is stored. */
  stored?: AuthorizationStoredView
}

/** Wire-safe projection of one offered authorization method. */
export interface AuthorizationMethodView {
  id: string
  label: string
}

/** Public state of one browser-owned authorization attempt. */
export interface AuthorizationAttemptView {
  /** Opaque host-minted attempt id. */
  attemptId: string
  /** Credential key being authorized; never a credential value. */
  key: string
  /** Selected flow method. */
  method: string
  /** Lifecycle state from the browser's point of view. */
  status: 'pending' | 'authorized' | 'cancelled' | 'failed'
  /** Notices emitted after the requested cursor. */
  notices: AuthorizationNoticeView[]
  /** Cursor to send with the next status request. */
  nextSeq: number
  /** Current prompt, if the flow is waiting for the browser. */
  prompt?: AuthorizationPromptView & { promptId: string }
  /** Redacted failure text; never contains a credential value. */
  error?: string
}

/** Authorization domain methods. */
export interface AuthorizationApi {
  /** List registered flows without credential values. */
  list(request: RpcRequest<{}>): Promise<RpcResponse<{ entries: AuthorizationEntryView[] }>>

  /** Start a background attempt and return before the flow asks its first question. */
  begin(
    request: RpcRequest<{ key: string; method?: string }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<{ attemptId: string; status: 'pending' }>>

  /** Read lifecycle, notices, and the current prompt for an opaque attempt id. */
  status(
    request: RpcRequest<{ attemptId: string; after?: number }>,
  ): Promise<RpcResponse<AuthorizationAttemptView>>

  /** Answer the current prompt. The value is write-only and is never returned. */
  answer(
    request: RpcRequest<{ attemptId: string; promptId: string; value: string }>,
  ): Promise<RpcResponse<{ accepted: true }>>

  /** Request cancellation of an attempt. */
  cancel(
    request: RpcRequest<{ attemptId: string }>,
  ): Promise<RpcResponse<{ cancelled: true }>>
}
