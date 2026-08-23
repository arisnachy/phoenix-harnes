/** Zod schemas for the browser authorization domain. */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { AuthorizationAttemptView, AuthorizationPromptView, AuthorizationNoticeView } from './authorization.ts'

const authorizationKeySchema = z.string().regex(/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/)
const attemptIdSchema = z.uuid()
const promptIdSchema = z.uuid()

const authorizationMethodSchema = z.object({ id: z.string().min(1), label: z.string().min(1) })
const authorizationEntrySchema = z.object({
  key: authorizationKeySchema,
  label: z.string().min(1),
  methods: z.array(authorizationMethodSchema).min(1),
  inFlight: z.boolean(),
  stored: z.object({ kind: z.union([z.literal('api-key'), z.literal('grant')]) }).optional(),
})

const authorizationNoticeSchema = z.object({
  seq: z.number().int().nonnegative(),
  notice: z.object({
    message: z.string(),
    url: z.url().optional(),
    code: z.string().optional(),
  }),
}) satisfies z.ZodType<Wire<AuthorizationNoticeView>>

const authorizationPromptSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), message: z.string(), placeholder: z.string().optional() }),
  z.object({ kind: z.literal('secret'), message: z.string(), placeholder: z.string().optional() }),
  z.object({
    kind: z.literal('select'),
    message: z.string(),
    options: z.array(z.object({
      id: z.string(), label: z.string(), description: z.string().optional(),
    })),
  }),
]) satisfies z.ZodType<Wire<AuthorizationPromptView>>

const authorizationAttemptSchema = z.object({
  attemptId: attemptIdSchema,
  key: authorizationKeySchema,
  method: z.string().min(1),
  status: z.union([
    z.literal('pending'), z.literal('authorized'), z.literal('cancelled'), z.literal('failed'),
  ]),
  notices: z.array(authorizationNoticeSchema),
  nextSeq: z.number().int().nonnegative(),
  prompt: authorizationPromptSchema.and(z.object({ promptId: promptIdSchema })).optional(),
  error: z.string().optional(),
}) satisfies z.ZodType<Wire<AuthorizationAttemptView>>

/** Validates an authorization catalog request. */
export const authorizationListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'authorization.list'>>>
/** Validates the credential-free authorization catalog returned to the browser. */
export const authorizationListValueSchema = z.object({ entries: z.array(authorizationEntrySchema) }) satisfies z.ZodType<Wire<ResponseValue<'authorization.list'>>>

/** Validates the registered flow and optional method selected by the browser. */
export const authorizationBeginRequestSchema = z.object({
  key: authorizationKeySchema,
  method: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'authorization.begin'>>>
/** Validates the opaque identifier returned for a newly pending flow. */
export const authorizationBeginValueSchema = z.object({
  attemptId: attemptIdSchema,
  status: z.literal('pending'),
}) satisfies z.ZodType<Wire<ResponseValue<'authorization.begin'>>>

/** Validates a cursor-based read of an authorization attempt. */
export const authorizationStatusRequestSchema = z.object({
  attemptId: attemptIdSchema,
  after: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'authorization.status'>>>
/** Validates the wire-safe attempt projection returned to the browser. */
export const authorizationStatusValueSchema = authorizationAttemptSchema satisfies z.ZodType<Wire<ResponseValue<'authorization.status'>>>

/** Validates a write-only answer to the currently pending flow prompt. */
export const authorizationAnswerRequestSchema = z.object({
  attemptId: attemptIdSchema,
  promptId: promptIdSchema,
  // Empty answers are meaningful to a few device flows; the flow decides whether they are valid.
  value: z.string(),
}) satisfies z.ZodType<Wire<RequestPayload<'authorization.answer'>>>
/** Validates acknowledgement that the host accepted a prompt answer. */
export const authorizationAnswerValueSchema = z.object({ accepted: z.literal(true) }) satisfies z.ZodType<Wire<ResponseValue<'authorization.answer'>>>

/** Validates cancellation of an opaque authorization attempt. */
export const authorizationCancelRequestSchema = z.object({
  attemptId: attemptIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'authorization.cancel'>>>
/** Validates acknowledgement that cancellation was requested. */
export const authorizationCancelValueSchema = z.object({ cancelled: z.literal(true) }) satisfies z.ZodType<Wire<ResponseValue<'authorization.cancel'>>>
