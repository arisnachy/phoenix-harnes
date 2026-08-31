/**
 * Server side of the fetch carrier: maps an ApiProxy onto a pure
 * WHATWG Request->Response function. Two-level parse: full form (type/rpcId/method +
 * path==method) -> payload dispatched per method. HTTP status expresses only the carrier
 * (404 unknown path / 415 non-JSON media type / 400 non-JSON body / 500 handler crash);
 * business errors are always 200 + ServerResponse.
 */

import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import type { ApiProxy, MuxFrame, HostFrame } from '../api/index.ts'
import { sessionLogQuerySchema } from '../api/downloads.schema.ts'
import type { RequestPayload, ResponseValue, RpcMethodMap } from '../api/rpc-map.ts'
import type { ClientRequest, RpcError, RpcRequest, RpcResponse, ServerRequest, ServerResponse } from '../api/rpc.ts'
import { RpcId } from '../api/rpc.ts'
import type { Wire } from '../api/rpc.schema.ts'
import { clientRequestSchema, clientResponseSchema } from '../api/rpc.schema.ts'
import {
  sessionCancelRequestSchema,
  sessionAttachmentRequestSchema,
  sessionCreateRequestSchema,
  sessionDeleteRequestSchema,
  sessionForkRequestSchema,
  sessionHistoryRequestSchema,
  sessionListRequestSchema,
  sessionModelsRequestSchema,
  sessionPromptRequestSchema,
  sessionRenameRequestSchema,
  sessionSearchRequestSchema,
  sessionSelectModelRequestSchema,
  sessionUpdateQueueRequestSchema,
} from '../api/sessions.schema.ts'
import {
  hostCreateDirectoryRequestSchema, hostDescribeRequestSchema,
  hostListDirectoryRequestSchema, hostOpenPathRequestSchema,
  hostPickDirectoryRequestSchema,
} from '../api/host.schema.ts'
import {
  workspaceArchiveSessionRequestSchema,
  workspaceCreateRequestSchema,
  workspaceDeleteRequestSchema,
  workspaceInsertBeforeRequestSchema,
  workspaceInsertSessionBeforeRequestSchema,
  workspaceListRequestSchema,
  workspaceRenameRequestSchema,
} from '../api/workspace.schema.ts'
import { skillListRequestSchema } from '../api/skills.schema.ts'
import {
  agentPresetCopyRequestSchema, agentPresetListRequestSchema, agentPresetOpenDocumentRequestSchema,
  agentPresetReadRequestSchema, agentPresetRemoveRequestSchema, agentPresetSelectRequestSchema,
} from '../api/agent-presets.schema.ts'
import {
  goalCreateRequestSchema,
  goalEditRequestSchema,
  goalPauseRequestSchema,
  goalResumeRequestSchema,
  goalCompleteRequestSchema,
  goalClearRequestSchema,
} from '../api/goals.schema.ts'
import {
  settingsDescribeRequestSchema, settingsMutateRequestSchema, settingsOpenDocumentRequestSchema,
  settingsReplaceRequestSchema, settingsUpdateRequestSchema,
} from '../api/settings.schema.ts'
import {
  credentialsDescribeRequestSchema, credentialsSetRequestSchema, credentialsUnsetRequestSchema,
} from '../api/credentials.schema.ts'
import { llmDiscoverModelsRequestSchema, llmModelsRequestSchema, llmProvidersRequestSchema } from '../api/llm.schema.ts'
import {
  authorizationAnswerRequestSchema, authorizationBeginRequestSchema, authorizationCancelRequestSchema,
  authorizationDisconnectRequestSchema, authorizationListRequestSchema, authorizationStatusRequestSchema,
} from '../api/authorization.schema.ts'
import {
  subagentHistoryRequestSchema,
  subagentInterruptRequestSchema,
  subagentListRequestSchema,
  subagentPromptRequestSchema,
} from '../api/subagents.schema.ts'

/**
 * Unary dispatch table, keyed by (and compiler-locked to) RpcMethodMap: a map row without a
 * route row fails to compile, and each row's schema/invoke pair is checked against that row's
 * payload type — a schema pasted onto the wrong row is a type error, not a runtime surprise.
 * Schemas anchor to the Wire<> widening (the repo-wide exactOptionalPropertyTypes accommodation
 * documented on Wire); the dispatch point carries the one Wire→exact cast.
 * Every invoke receives the carrier Request's signal; routes whose contract
 * declares a signal parameter forward it, and the rest ignore it.
 */
type UnaryRoutes = {
  [K in keyof RpcMethodMap]: {
    schema: z.ZodType<Wire<RequestPayload<K>>>
    invoke(api: ApiProxy, request: RpcRequest<RequestPayload<K>>, signal: AbortSignal): Promise<RpcResponse<ResponseValue<K>>>
  }
}

const UNARY_ROUTES: UnaryRoutes = {
  'session.list': { schema: sessionListRequestSchema, invoke: (api, r) => api.sessions.list(r) },
  'session.search': { schema: sessionSearchRequestSchema, invoke: (api, r, signal) => api.sessions.search(r, signal) },
  'session.create': { schema: sessionCreateRequestSchema, invoke: (api, r) => api.sessions.create(r) },
  'session.history': { schema: sessionHistoryRequestSchema, invoke: (api, r) => api.sessions.history(r) },
  'session.models': { schema: sessionModelsRequestSchema, invoke: (api, r) => api.sessions.models(r) },
  'session.selectModel': { schema: sessionSelectModelRequestSchema, invoke: (api, r) => api.sessions.selectModel(r) },
  'session.rename': { schema: sessionRenameRequestSchema, invoke: (api, r) => api.sessions.rename(r) },
  'session.delete': {
    schema: sessionDeleteRequestSchema,
    invoke: async (api, r) => {
      const sessions = api.sessions
      if (sessions.delete === undefined) throw new Error('session deletion is unavailable')
      return sessions.delete(r)
    },
  },
  'session.fork': { schema: sessionForkRequestSchema, invoke: (api, r) => api.sessions.fork(r) },
  'session.prompt': { schema: sessionPromptRequestSchema, invoke: (api, r) => api.sessions.prompt(r) },
  'session.attachment': { schema: sessionAttachmentRequestSchema, invoke: (api, r) => api.sessions.attachment(r) },
  'session.updateQueue': { schema: sessionUpdateQueueRequestSchema, invoke: (api, r) => api.sessions.updateQueue(r) },
  'session.cancel': { schema: sessionCancelRequestSchema, invoke: (api, r) => api.sessions.cancel(r) },
  'subagent.list': { schema: subagentListRequestSchema, invoke: (api, r, signal) => api.subagents.list(r, signal) },
  'subagent.history': { schema: subagentHistoryRequestSchema, invoke: (api, r, signal) => api.subagents.history(r, signal) },
  'subagent.prompt': { schema: subagentPromptRequestSchema, invoke: (api, r, signal) => api.subagents.prompt(r, signal) },
  'subagent.interrupt': { schema: subagentInterruptRequestSchema, invoke: (api, r) => api.subagents.interrupt(r) },
  'host.describe': { schema: hostDescribeRequestSchema, invoke: (api, r) => api.host.describe(r) },
  'host.pickDirectory': { schema: hostPickDirectoryRequestSchema, invoke: (api, r, signal) => api.host.pickDirectory(r, signal) },
  'host.listDirectory': { schema: hostListDirectoryRequestSchema, invoke: (api, r, signal) => api.host.listDirectory(r, signal) },
  'host.createDirectory': { schema: hostCreateDirectoryRequestSchema, invoke: (api, r) => api.host.createDirectory(r) },
  'host.openPath': { schema: hostOpenPathRequestSchema, invoke: (api, r, signal) => api.host.openPath(r, signal) },
  'workspace.list': { schema: workspaceListRequestSchema, invoke: (api, r) => api.workspace.list(r) },
  'workspace.create': { schema: workspaceCreateRequestSchema, invoke: (api, r) => api.workspace.create(r) },
  'workspace.rename': { schema: workspaceRenameRequestSchema, invoke: (api, r) => api.workspace.rename(r) },
  'workspace.delete': { schema: workspaceDeleteRequestSchema, invoke: (api, r) => api.workspace.delete(r) },
  'workspace.insertBefore': { schema: workspaceInsertBeforeRequestSchema, invoke: (api, r) => api.workspace.insertBefore(r) },
  'workspace.insertSessionBefore': { schema: workspaceInsertSessionBeforeRequestSchema, invoke: (api, r) => api.workspace.insertSessionBefore(r) },
  'workspace.archiveSession': { schema: workspaceArchiveSessionRequestSchema, invoke: (api, r) => api.workspace.archiveSession(r) },
  'skill.list': { schema: skillListRequestSchema, invoke: (api, r) => api.skills.list(r) },
  'agentPreset.list': { schema: agentPresetListRequestSchema, invoke: (api, r) => api.agentPresets.list(r) },
  'agentPreset.select': { schema: agentPresetSelectRequestSchema, invoke: (api, r) => api.agentPresets.select(r) },
  'agentPreset.read': { schema: agentPresetReadRequestSchema, invoke: (api, r) => api.agentPresets.read(r) },
  'agentPreset.copy': { schema: agentPresetCopyRequestSchema, invoke: (api, r) => api.agentPresets.copy(r) },
  'agentPreset.openDocument': { schema: agentPresetOpenDocumentRequestSchema, invoke: (api, r, signal) => api.agentPresets.openDocument(r, signal) },
  'agentPreset.remove': { schema: agentPresetRemoveRequestSchema, invoke: (api, r) => api.agentPresets.remove(r) },
  'goal.create': { schema: goalCreateRequestSchema, invoke: (api, r) => api.goals.create(r) },
  'goal.edit': { schema: goalEditRequestSchema, invoke: (api, r) => api.goals.edit(r) },
  'goal.pause': { schema: goalPauseRequestSchema, invoke: (api, r) => api.goals.pause(r) },
  'goal.resume': { schema: goalResumeRequestSchema, invoke: (api, r) => api.goals.resume(r) },
  'goal.complete': { schema: goalCompleteRequestSchema, invoke: (api, r) => api.goals.complete(r) },
  'goal.clear': { schema: goalClearRequestSchema, invoke: (api, r) => api.goals.clear(r) },
  'settings.describe': { schema: settingsDescribeRequestSchema, invoke: (api, r) => api.settings.describe(r) },
  'settings.openDocument': { schema: settingsOpenDocumentRequestSchema, invoke: (api, r, signal) => api.settings.openDocument(r, signal) },
  'settings.update': { schema: settingsUpdateRequestSchema, invoke: (api, r) => api.settings.update(r) },
  'settings.replace': { schema: settingsReplaceRequestSchema, invoke: (api, r) => api.settings.replace(r) },
  'settings.mutate': { schema: settingsMutateRequestSchema, invoke: (api, r) => api.settings.mutate(r) },
  'credentials.describe': { schema: credentialsDescribeRequestSchema, invoke: (api, r) => api.credentials.describe(r) },
  'credentials.set': { schema: credentialsSetRequestSchema, invoke: (api, r) => api.credentials.set(r) },
  'credentials.unset': { schema: credentialsUnsetRequestSchema, invoke: (api, r) => api.credentials.unset(r) },
  'llm.providers': { schema: llmProvidersRequestSchema, invoke: (api, r) => api.llm.providers(r) },
  'llm.models': { schema: llmModelsRequestSchema, invoke: (api, r) => api.llm.models(r) },
  'llm.discoverModels': { schema: llmDiscoverModelsRequestSchema, invoke: (api, r, signal) => api.llm.discoverModels(r, signal) },
  'authorization.list': { schema: authorizationListRequestSchema, invoke: (api, r) => api.authorization.list(r) },
  'authorization.begin': { schema: authorizationBeginRequestSchema, invoke: (api, r, signal) => api.authorization.begin(r, signal) },
  'authorization.status': { schema: authorizationStatusRequestSchema, invoke: (api, r) => api.authorization.status(r) },
  'authorization.answer': { schema: authorizationAnswerRequestSchema, invoke: (api, r) => api.authorization.answer(r) },
  'authorization.cancel': { schema: authorizationCancelRequestSchema, invoke: (api, r) => api.authorization.cancel(r) },
  'authorization.disconnect': { schema: authorizationDisconnectRequestSchema, invoke: (api, r, signal) => api.authorization.disconnect(r, signal) },
}

function methodFor(path: string): keyof RpcMethodMap | undefined {
  return Object.hasOwn(UNARY_ROUTES, path) ? path as keyof RpcMethodMap : undefined
}

const INVALID_REQUEST_RPC_ID = RpcId('invalid-request')

function errorResponse(rpcId: RpcId, error: RpcError): Response {
  const body: ServerResponse = { type: 'server-response', rpcId, result: { ok: false, error } }
  return Response.json(body)
}

function fullResponse(narrow: RpcResponse<unknown>): Response {
  const body: ServerResponse = { type: 'server-response', rpcId: narrow.rpcId, result: narrow.result }
  return Response.json(body)
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
async function handleUnary<K extends keyof RpcMethodMap>(
  api: ApiProxy, method: K, message: ClientRequest, signal: AbortSignal,
): Promise<Response> {
  const route = UNARY_ROUTES[method]
  const payload = route.schema.safeParse(message.payload)
  if (!payload.success) {
    return errorResponse(message.rpcId, { code: 'bad-request', message: `invalid payload for ${method}`, details: { issues: payload.error.issues } })
  }
  try {
    return fullResponse(await route.invoke(api, { rpcId: message.rpcId, payload: payload.data }, signal))
  } catch (error: unknown) {
    return new Response(`handler failure: ${String(error)}`, { status: 500 })
  }
}

function fullFrame(narrow: RpcRequest<MuxFrame | HostFrame>): ServerRequest {
  return { type: 'server-request', rpcId: narrow.rpcId, method: narrow.payload.type, payload: narrow.payload }
}

function sseResponse(frames: AsyncIterable<RpcRequest<MuxFrame | HostFrame>>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(': connected\n\n'))
        for await (const narrow of frames) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(fullFrame(narrow))}\n\n`))
        }
      } catch (error: unknown) {
        const failure: MuxFrame | HostFrame = { type: 'stream/error', error: { code: 'internal', message: String(error), details: {} } }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(fullFrame({ rpcId: RpcId(randomUUID()), payload: failure }))}\n\n`))
        } catch {
          // Consumer already cancelled.
        }
      } finally {
        try {
          controller.close()
        } catch { /* already cancelled */ }
      }
    },
  })
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  })
}

/**
 * Wraps an ApiProxy into a pure fetch function (isomorphic point: feed the returned fetch straight to InProcessApiClient).
 * @param api - the host-side ApiProxy implementation.
 * @returns an object holding `fetch(Request)`; paths outside /api/ return 404.
 */
export function toFetchHandler(api: ApiProxy): { fetch: typeof fetch } {
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const req = input instanceof Request ? input : new Request(input, init)
      const url = new URL(req.url)
      const path = url.pathname

      if (path === '/api/events.mux' && req.method === 'GET') {
        return sseResponse(api.events.mux({ rpcId: RpcId(randomUUID()), payload: {} }, req.signal))
      }
      if (path === '/api/events.host' && req.method === 'GET') {
        return sseResponse(api.events.host({ rpcId: RpcId(randomUUID()), payload: {} }, req.signal))
      }
      if (path === '/api/session.export' && (req.method === 'GET' || req.method === 'HEAD')) {
        const parsed = sessionLogQuerySchema.safeParse(Object.fromEntries(url.searchParams))
        if (!parsed.success) {
          return new Response('missing or invalid sessionId query parameter', { status: 400 })
        }
        const response = await api.downloads.sessionLog(parsed.data, req.signal)
        if (req.method === 'GET') return response
        await response.body?.cancel()
        return new Response(null, { status: response.status, headers: response.headers })
      }

      if (req.method !== 'POST' || !path.startsWith('/api/')) {
        return new Response('not found', { status: 404 })
      }

      const mediaType = req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }

      let body: unknown
      try {
        body = await req.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }

      if (path === '/api/respond') {
        const parsed = clientResponseSchema.safeParse(body)
        if (!parsed.success) return Response.json({ accepted: false, reason: 'bad-response' })
        return Response.json(await api.respond(parsed.data))
      }

      const method = methodFor(path.slice('/api/'.length))
      if (method === undefined) return new Response('not found', { status: 404 })

      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) {
        const rawId = (body as { rpcId?: unknown } | null)?.rpcId
        const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID
        return errorResponse(rpcId, { code: 'bad-request', message: 'invalid client-request message', details: { issues: envelope.error.issues } })
      }
      const message: ClientRequest = envelope.data
      if (message.method !== method) {
        return errorResponse(message.rpcId, { code: 'bad-request', message: `method "${message.method}" does not match path "${method}"`, details: { issues: [] } })
      }
      return handleUnary(api, method, message, req.signal)
    },
  }
}
