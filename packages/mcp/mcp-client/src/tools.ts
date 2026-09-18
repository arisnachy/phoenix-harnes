/**
 * Tool bridge: discovers MCP tools, registers them on the harness ToolRuntime
 * under deterministic server-qualified public names, and handles re-sync when
 * the server's tool list changes.
 *
 * Naming contract (see the mcp-client Agent Note "Naming invariants"): every MCP tool
 * has the stable identity `(serverName, rawName)`; the model-facing public name
 * is `mcp__<serverName>__<rawName>`, normalized to the DeepSeek function-name
 * constraints. The raw name is only ever sent on the wire (`tools/call`); the
 * public name is never parsed to recover it.
 *
 * @module
 */

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { Context } from '@phoenix-ai/cordis'
import { isImageAdmissionError } from '@phoenix-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType, SaveImageAttachment } from '@phoenix-ai/dsh-attachment'
import type { ContentBlock } from '@phoenix-ai/dsh-llm'
import type { ToolDefinition, ToolExecution, ToolExecutionResult } from '@phoenix-ai/dsh-tools'
import { assertSupportedJsonSchema } from '@phoenix-ai/dsh-tools'
import type { JsonSchemaNode, JsonValue } from '@phoenix-ai/dsh-tools'

/** Resolved options relevant to tool bridging. */
export interface ToolBridgeOptions {
  /** Whether a registry conflict is contained or rejects this synchronization. */
  registrationFailure: 'contain' | 'throw'
  serverName: string
  toolCallTimeoutMs: number
}

/** State for one sync generation: the current set of disposers keyed by public name. */
export type ToolDisposers = Map<string, () => void>

/** Canonical MCP result exposed to Code Mode without discarding protocol blocks. */
export type McpResult<Structured extends JsonValue = JsonValue> = {
  content: JsonValue[]
  structuredContent?: Structured
  /** MCP result metadata kept for an MCP App View but never rendered into model text. */
  _meta?: JsonValue
}

/** One validated MCP Apps HTML resource prefetched from a tool's ui:// URI. */
interface McpAppResource {
  resourceUri: string
  html: string
  csp?: {
    connectDomains?: string[]
    resourceDomains?: string[]
    frameDomains?: string[]
    baseUriDomains?: string[]
  }
  permissions?: {
    camera?: boolean
    microphone?: boolean
    geolocation?: boolean
    clipboardWrite?: boolean
  }
}

/** MCP Apps stable HTML media type. */
const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'

/** Prevent an external MCP server from turning one tool definition into an unbounded Web payload. */
const MAX_MCP_APP_HTML_BYTES = 4 * 1024 * 1024

/**
 * DeepSeek function-name contract: at most 64 characters. Wire-protocol
 * constant, not configuration.
 */
const MAX_PUBLIC_NAME_LENGTH = 64

/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g

/** Hex chars of the SHA-256 identity hash appended on lossy normalization. */
const HASH_LENGTH = 12

/** Raw result record: the bridge owns JSON-value validation after transport. */
const RawCallToolResultSchema = z.record(z.string(), z.unknown())

/** Raw resources/read result: the bridge validates the one UI document it consumes. */
const RawReadResourceResultSchema = z.record(z.string(), z.unknown())

/** Raster formats supported by the durable attachment vocabulary. */
const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]

/** Canonical RFC 4648 base64, excluding whitespace and URL-safe aliases. */
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** List without mutating the SDK's per-page output-validator cache. */
function listToolsUncached(client: Client, cursor?: string) {
  return client.request(
    { method: 'tools/list', ...cursor === undefined ? {} : { params: { cursor } } },
    ListToolsResultSchema,
  )
}

/** Call without the SDK pre-validating an output schema the bridge may not support. */
function callToolUncached(
  client: Client,
  rawName: string,
  args: Record<string, unknown>,
  exec: ToolExecution,
  opts: ToolBridgeOptions,
) {
  return client.request(
    { method: 'tools/call', params: { name: rawName, arguments: args } },
    RawCallToolResultSchema,
    {
      signal: exec.signal,
      timeout: opts.toolCallTimeoutMs,
    },
  )
}


/** Narrow an untrusted object-shaped protocol field. */
function unknownRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Read modern and legacy MCP Apps tool metadata without depending on ext-apps at runtime. */
function toolAppMetadata(tool: unknown): { resourceUri?: string; visibility?: string[] } {
  const meta = unknownRecord(unknownRecord(tool)?._meta)
  const ui = unknownRecord(meta?.ui)
  const modern = ui?.resourceUri
  const legacy = meta?.['ui/resourceUri']
  const candidate = typeof modern === 'string' ? modern : legacy
  const resourceUri = typeof candidate === 'string' && candidate.startsWith('ui://')
    ? candidate
    : undefined
  const visibility = Array.isArray(ui?.visibility)
    ? ui.visibility.filter((entry): entry is string => typeof entry === 'string')
    : undefined
  return { ...resourceUri === undefined ? {} : { resourceUri }, ...visibility === undefined ? {} : { visibility } }
}

/** App-only tools stay callable inside a future interactive bridge but are never exposed to the model. */
function visibleToModel(visibility: readonly string[] | undefined): boolean {
  return visibility === undefined || visibility.includes('model')
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
  return strings.length === 0 ? undefined : strings
}

/** Normalize resource security metadata into Phoenix's provider-neutral result view. */
function resourceSecurityMeta(content: Record<string, unknown>): Pick<McpAppResource, 'csp' | 'permissions'> {
  const meta = unknownRecord(content._meta)
  const ui = unknownRecord(meta?.ui)
  const rawCsp = unknownRecord(ui?.csp)
  const csp = rawCsp === undefined ? undefined : {
    ...stringList(rawCsp.connectDomains) === undefined ? {} : { connectDomains: stringList(rawCsp.connectDomains) },
    ...stringList(rawCsp.resourceDomains) === undefined ? {} : { resourceDomains: stringList(rawCsp.resourceDomains) },
    ...stringList(rawCsp.frameDomains) === undefined ? {} : { frameDomains: stringList(rawCsp.frameDomains) },
    ...stringList(rawCsp.baseUriDomains) === undefined ? {} : { baseUriDomains: stringList(rawCsp.baseUriDomains) },
  }
  const rawPermissions = unknownRecord(ui?.permissions)
  const requested = (key: string): boolean | undefined => {
    const value = rawPermissions?.[key]
    return value === true || unknownRecord(value) !== undefined ? true : undefined
  }
  const permissions = rawPermissions === undefined ? undefined : {
    ...requested('camera') === undefined ? {} : { camera: true },
    ...requested('microphone') === undefined ? {} : { microphone: true },
    ...requested('geolocation') === undefined ? {} : { geolocation: true },
    ...requested('clipboardWrite') === undefined ? {} : { clipboardWrite: true },
  }
  return {
    ...csp === undefined ? {} : { csp },
    ...permissions === undefined ? {} : { permissions },
  }
}

/**
 * Prefetch one ui:// document. Failure is contained: the tool remains available
 * with its ordinary text fallback instead of making an optional UI break MCP.
 */
async function readMcpAppResource(
  client: Client,
  ctx: Context,
  resourceUri: string,
  opts: ToolBridgeOptions,
): Promise<McpAppResource | undefined> {
  try {
    const response = await client.request(
      { method: 'resources/read', params: { uri: resourceUri } },
      RawReadResourceResultSchema,
      { timeout: opts.toolCallTimeoutMs },
    )
    const contents = Array.isArray(response.contents) ? response.contents : []
    const candidate = contents
      .map(unknownRecord)
      .find(item => item?.uri === resourceUri) ?? contents.map(unknownRecord).find(item => item !== undefined)
    if (candidate === undefined) throw new Error('resources/read returned no content')
    if (candidate.mimeType !== MCP_APP_MIME_TYPE) {
      throw new Error(`expected ${MCP_APP_MIME_TYPE}, received ${String(candidate.mimeType ?? 'no MIME type')}`)
    }
    let html: string
    if (typeof candidate.text === 'string') {
      html = candidate.text
    } else if (typeof candidate.blob === 'string' && CANONICAL_BASE64.test(candidate.blob)) {
      html = Buffer.from(candidate.blob, 'base64').toString('utf8')
    } else {
      throw new Error('MCP App resource has neither text HTML nor canonical base64 blob')
    }
    if (Buffer.byteLength(html, 'utf8') > MAX_MCP_APP_HTML_BYTES) {
      throw new Error(`MCP App resource exceeds ${MAX_MCP_APP_HTML_BYTES} bytes`)
    }
    return {
      resourceUri,
      html,
      ...resourceSecurityMeta(candidate),
    }
  } catch (error) {
    ctx.logger.warn(`mcp-client(${opts.serverName}): UI resource ${resourceUri} unavailable; keeping text fallback: ${String(error)}`)
    return undefined
  }
}

/**
 * Derive the model-facing public name for one MCP tool.
 *
 * Deterministic pure function of `(serverName, rawName)`: the clean case is
 * `mcp__<serverName>__<rawName>` verbatim. When character replacement or
 * truncation to the DeepSeek function-name contract (64 chars,
 * `[A-Za-z0-9_-]`) changes the name, a 12-hex-char SHA-256 hash of the
 * identity is appended so distinct MCP identities never collapse into the
 * same public name.
 *
 * @param serverName - Stable local namespace from plugin config.
 * @param rawName - The MCP server's own tool name.
 * @returns The globally unique, model-facing ToolRuntime name.
 */
export function publicToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

/**
 * Sync the MCP server's tool list into the harness ToolRuntime.
 *
 * Two phases keep the swap safe:
 *
 * 1. Fetch: drain uncached `tools/list` pagination and build the full next
 *    generation of `ToolDefinition`s under public names. Any failure here
 *    (network error, duplicate raw name in the server's list) rejects and
 *    leaves the previous generation registered untouched.
 * 2. Swap: dispose the previous generation, register the new one. A registry
 *    conflict here can only mean a foreign registration squats on this
 *    server's `mcp__<serverName>__` namespace — the partial generation is
 *    rolled back (zero tools from this server) and logged. Initial strict
 *    synchronization may propagate the conflict so its parent transaction
 *    rejects; ordinary clients and later re-syncs return an empty map.
 *
 * @param client - Connected MCP Client instance used to list and call tools.
 * @param ctx - Cordis context providing the `tools` service for registration.
 * @param opts - Bridge options: server namespace and per-call timeout.
 * @param previous - Disposer map from the prior sync generation; disposed
 *   during the swap phase (only after the fetch phase succeeded).
 * @returns A map of registered public tool names to their unregister
 *   disposers — the exact set of live registrations owned by this server.
 */
export async function syncTools(
  client: Client,
  ctx: Context,
  opts: ToolBridgeOptions,
  previous: ToolDisposers,
): Promise<ToolDisposers> {
  // Phase 1: fetch and build the next generation without touching the registry.
  const definitions = new Map<string, ToolDefinition>()
  const appResources = new Map<string, Promise<McpAppResource | undefined>>()
  let cursor: string | undefined
  do {
    const response = await listToolsUncached(client, cursor)
    for (const tool of response.tools) {
      const appMeta = toolAppMetadata(tool)
      if (!visibleToModel(appMeta.visibility)) continue
      const appResource = appMeta.resourceUri === undefined
        ? undefined
        : await (appResources.get(appMeta.resourceUri) ?? (() => {
            const pending = readMcpAppResource(client, ctx, appMeta.resourceUri as string, opts)
            appResources.set(appMeta.resourceUri as string, pending)
            return pending
          })())
      const publicName = publicToolName(opts.serverName, tool.name)
      if (definitions.has(publicName)) {
        throw new Error(
          `mcp-client(${opts.serverName}): server listed tool "${tool.name}" more than once — invalid tool list`,
        )
      }
      definitions.set(publicName, createDefinition(
        client,
        ctx,
        publicName,
        tool.name,
        tool.description ?? '',
        tool.inputSchema,
        supportedOutputSchema(tool.outputSchema),
        tool.execution?.taskSupport === 'required',
        opts,
        appResource,
        typeof tool.title === 'string' && tool.title !== '' ? tool.title : tool.name,
      ))
    }
    cursor = response.nextCursor
  } while (cursor)

  // Phase 2: swap generations.
  for (const dispose of previous.values()) dispose()
  const disposers: ToolDisposers = new Map()
  try {
    for (const [publicName, definition] of definitions) {
      disposers.set(publicName, ctx.tools.register(definition))
    }
  } catch (error) {
    // A conflict on an `mcp__<serverName>__`-qualified name means a foreign
    // registration occupies this server's namespace. Roll back so the model
    // sees either the full generation or none of it — never a partial set.
    for (const dispose of disposers.values()) dispose()
    ctx.logger.error(`mcp-client(${opts.serverName}): tool registration failed, no tools registered: ${String(error)}`)
    if (opts.registrationFailure === 'throw') throw error
    return new Map()
  }
  return disposers
}

/**
 * The shape we read from each MCP content block. Intentionally looser than the
 * SDK's `ContentBlock` type: we're at a network trust boundary (data arrives
 * from an external MCP server process via JSON-RPC), so fields that the SDK
 * declares required may be absent at runtime if the server is buggy.
 */
interface McpContentBlock {
  type: string
  text?: string
  mimeType?: string
  data?: string
  name?: string
  uri?: string
}

/** Async rich projection staged for one exact ToolRuntime execution. */
interface PreparedProjection {
  /** Canonical MCP value returned by execute before registry materialization. */
  value: McpResult
  /** Synchronous output.render projection expected before finalization. */
  fallback: ContentBlock[]
  /** Image-enriched or explicit-refusal projection prepared during execute. */
  content: ContentBlock[]
}

/** Keep a supported advertised schema; unsupported MCP vocabulary falls back to JsonValue. */
function supportedOutputSchema(candidate: unknown): JsonSchemaNode | undefined {
  if (candidate === undefined) return undefined
  try {
    assertSupportedJsonSchema(candidate)
    return candidate
  } catch {
    return undefined
  }
}

/**
 * Build one generation-local tool definition and its execution-local rich projections.
 * @param client - connected MCP client used for calls.
 * @param ctx - plugin context carrying optional attachment and model services.
 * @param publicName - registry-qualified public tool name.
 * @param rawName - MCP wire tool name.
 * @param description - model-facing tool description.
 * @param parameters - MCP input schema.
 * @param structuredSchema - supported structured-output schema, when advertised.
 * @param taskRequired - whether this MCP tool requires unsupported task execution.
 * @param opts - bridge timeout and namespace options.
 * @returns a complete ToolRuntime definition.
 */
function createDefinition(
  client: Client,
  ctx: Context,
  publicName: string,
  rawName: string,
  description: string,
  parameters: Record<string, unknown>,
  structuredSchema: JsonSchemaNode | undefined,
  taskRequired: boolean,
  opts: ToolBridgeOptions,
  appResource: McpAppResource | undefined,
  appTitle: string,
): ToolDefinition {
  const projections = new WeakMap<ToolExecution, PreparedProjection>()
  return {
    name: publicName,
    description,
    parameters,
    output: createOutput(rawName, structuredSchema, appResource),
    execute: createExecutor(client, ctx, rawName, taskRequired, opts, projections),
    ...appResource === undefined ? {} : {
      presentResult(args, result) {
        if (result.isError || !isRecord(result.meta as JsonValue)) return { card: 'generic' as const }
        const envelope = result.meta.mcpApp
        if (!isRecord(envelope) || envelope.resourceUri !== appResource.resourceUri || !isRecord(envelope.result)) {
          return { card: 'generic' as const }
        }
        const toolInput = unknownRecord(args) ?? {}
        return {
          card: 'mcp-app' as const,
          title: appTitle,
          resourceUri: appResource.resourceUri,
          html: appResource.html,
          toolInput,
          toolResult: envelope.result as Record<string, unknown>,
          ...appResource.csp === undefined ? {} : { csp: appResource.csp },
          ...appResource.permissions === undefined ? {} : { permissions: appResource.permissions },
        }
      },
    },
    finalizeContent(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) {
      const projection = projections.get(exec)
      if (projection === undefined) return undefined
      projections.delete(exec)
      if (result.isError) return undefined
      if (!isDeepStrictEqual(result.value, projection.value)) return undefined
      if (!isDeepStrictEqual(result.content, projection.fallback)) return undefined
      return projection.content
    },
  }
}

/** Build the canonical result schema and existing Native text projection. */
function createOutput(
  rawName: string,
  structuredSchema: JsonSchemaNode | undefined,
  appResource: McpAppResource | undefined,
): ToolDefinition['output'] {
  return {
    schema: {
      type: 'object',
      properties: {
        content: { type: 'array', items: {} },
        structuredContent: structuredSchema ?? {},
        _meta: {},
      },
      required: structuredSchema === undefined ? ['content'] : ['content', 'structuredContent'],
      additionalProperties: false,
    },
    render(_args: unknown, value: JsonValue) {
      const result = value as unknown as McpResult
      return [{ type: 'text', text: extractText(result.content, rawName) }]
    },
    ...appResource === undefined ? {} : {
      presentationMeta(_args: unknown, value: JsonValue): JsonValue {
        return {
          mcpApp: {
            resourceUri: appResource.resourceUri,
            result: value,
          },
        }
      },
    },
  }
}

/**
 * Create an execute function for one MCP tool. The executor closes over the
 * raw MCP tool name and sends an uncached `tools/call` request with it (never
 * the public name), with abort signal and timeout, then maps the result to
 * harness ContentBlocks. Owning the raw request prevents the SDK's internal
 * per-page schema cache from pre-validating a different contract.
 *
 * When the MCP server returns `isError: true`, the executor throws so that
 * the ToolRuntime's catch path produces an `isError` result for the model.
 */
function createExecutor(
  client: Client,
  ctx: Context,
  rawName: string,
  taskRequired: boolean,
  opts: ToolBridgeOptions,
  projections: WeakMap<ToolExecution, PreparedProjection>,
): ToolDefinition['execute'] {
  return async (args: unknown, exec: ToolExecution) => {
    if (taskRequired) {
      throw new Error(`Tool "${rawName}" requires task-based execution, which this bridge does not support`)
    }
    // The agent loop passes `JSON.parse(model_arguments)` which is usually an
    // object, but can be any JSON value if the model misbehaves (outputs a bare
    // string/number/null). Fallback to {} lets the MCP server produce a
    // specific "missing required param" error the model can learn from.
    const argsObj = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
    const result = await callToolUncached(client, rawName, argsObj, exec, opts)

    // The SDK may return a legacy `toolResult` shape; normalize to content array.
    if (!Array.isArray(result.content)) {
      const rendered: unknown = 'toolResult' in result
        ? JSON.stringify(result.toolResult)
        : '(no output)'
      const text = typeof rendered === 'string' ? rendered : '(no output)'
      if (result.isError === true) throw new Error(text)
      return {
        content: [{ type: 'text', text }],
        ...result.structuredContent !== undefined
          ? { structuredContent: result.structuredContent as JsonValue }
          : {},
        ...result._meta !== undefined
          ? { _meta: result._meta as JsonValue }
          : {},
      }
    }

    // Trust boundary: the SDK's return type erases to `any[]` due to the
    // union of CallToolResult | CompatibilityCallToolResult; extractText
    // validates each element.
    const content = result.content as unknown as JsonValue[]
    const text = extractText(content, rawName)

    // MCP isError → throw so ToolRuntime produces an isError result for the model.
    if (result.isError === true) {
      throw new Error(text)
    }

    const value: McpResult = {
      content,
      ...result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent as JsonValue }
        : {},
      ...result._meta !== undefined
        ? { _meta: result._meta as JsonValue }
        : {},
    }
    if (containsImage(content)) {
      const fallback: ContentBlock[] = [{ type: 'text', text: extractText(content, rawName) }]
      const projected = await prepareImageProjection(ctx, exec, content, rawName)
      projections.set(exec, { value, fallback, content: projected })
    }
    return value
  }
}

/** Whether an untrusted MCP content array contains a declared image block. */
function containsImage(content: JsonValue[]): boolean {
  return content.some(value => isRecord(value) && value.type === 'image')
}

/** Narrow one JSON value to a string-keyed object. */
function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow a declared MIME string to the durable image vocabulary. */
function isImageMediaType(value: string): value is ImageMediaType {
  return IMAGE_MEDIA_TYPES.includes(value as ImageMediaType)
}

/** Decode one untrusted MCP image block without accepting base64 aliases. */
function decodeImage(block: McpContentBlock): SaveImageAttachment {
  if (block.mimeType === undefined || !isImageMediaType(block.mimeType)) {
    throw new Error('the declared media type is not PNG, JPEG, WebP, or GIF')
  }
  if (block.data === undefined || !CANONICAL_BASE64.test(block.data)) {
    throw new Error('the image data is not canonical base64')
  }
  const data = Buffer.from(block.data, 'base64')
  if (data.toString('base64') !== block.data) {
    throw new Error('the image data is not canonical base64')
  }
  return { data, mediaType: block.mimeType }
}

/**
 * Resolve the active model route and durable store for an image-bearing result.
 * @param ctx - plugin context with optional services.
 * @param exec - exact tool execution whose agent supplies the latest route.
 * @returns the attachment store after exact positive image-capability proof.
 */
async function resolveImageAdmission(ctx: Context, exec: ToolExecution): Promise<AttachmentStore> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) throw new Error('no attachment store is mounted')
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('the current model route could not be resolved')
  }
  let info: Awaited<ReturnType<typeof llm.resolveModelInfo>>
  try {
    info = await llm.resolveModelInfo(provider, model, exec.signal)
  } catch {
    throw new Error('the current model route could not be verified')
  }
  if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
    throw new Error(`model "${model}" does not declare image input`)
  }
  if (exec.signal.aborted) throw new Error('the tool call was canceled before image storage')
  return attachments
}

/** Stable diagnostic text for an image block that was not admitted. */
function imageDiagnostic(block: McpContentBlock, reason: string): string {
  const mediaType = block.mimeType ?? 'unknown media type'
  return `[image unavailable: ${mediaType}; ${reason}; raw image data remains available to programmatic callers]`
}

/**
 * Decode, preflight, and durably save one MCP result's ordered image batch.
 * Any refusal projects every image as text while retaining the canonical raw
 * value for programmatic callers.
 */
async function prepareImageProjection(
  ctx: Context,
  exec: ToolExecution,
  content: JsonValue[],
  toolName: string,
): Promise<ContentBlock[]> {
  const decoded: SaveImageAttachment[] = []
  const validationErrors = new Map<number, string>()
  const imageIndexes: number[] = []
  for (const [index, value] of content.entries()) {
    if (!isRecord(value) || value.type !== 'image') continue
    imageIndexes.push(index)
    try {
      decoded.push(decodeImage(value as unknown as McpContentBlock))
    } catch (error: unknown) {
      // decodeImage owns every throw above and always produces Error.
      validationErrors.set(index, (error as Error).message)
    }
  }
  if (validationErrors.size > 0) {
    return projectContent(content, toolName, (block, index) => ({
      type: 'text',
      text: imageDiagnostic(
        block,
        validationErrors.get(index) ?? 'another image in the same result was invalid',
      ),
    }))
  }

  let attachments: AttachmentStore
  try {
    attachments = await resolveImageAdmission(ctx, exec)
  } catch (error: unknown) {
    // resolveImageAdmission contains provider failures and throws Error only.
    const reason = (error as Error).message
    return projectContent(content, toolName, block => ({ type: 'text', text: imageDiagnostic(block, reason) }))
  }

  try {
    const refs = await attachments.saveImages(decoded)
    const byIndex = new Map(imageIndexes.map((index, offset) => [index, refs[offset] as ImageAttachmentRef] as const))
    return projectContent(content, toolName, (_block, index) => ({
      type: 'image',
      attachment: byIndex.get(index) as ImageAttachmentRef,
    }))
  } catch (error: unknown) {
    const reason = isImageAdmissionError(error)
      ? `image admission rejected the result: ${error.message}`
      : 'durable image storage rejected the result'
    return projectContent(content, toolName, block => ({
      type: 'text',
      text: imageDiagnostic(block, reason),
    }))
  }
}

/**
 * Extract text from an MCP content array into a single string.
 * - text blocks: join with '\n'
 * - image/audio/resource blocks: replaced with a placeholder
 *
 * Defensive: fields that the MCP spec declares required (mimeType, text) are
 * guarded with fallbacks because this is a network trust boundary.
 */
function extractText(mcpContent: JsonValue[], toolName: string): string {
  const content = projectContent(mcpContent, toolName)
  // The default image projector below also returns text, so this local call
  // cannot produce a core image block.
  return content.map(block => (block as Extract<ContentBlock, { type: 'text' }>).text).join('\n')
}

/**
 * Project ordered MCP blocks into the core content vocabulary.
 * Text-like runs are newline-coalesced; admitted images split those runs at
 * their original position.
 */
function projectContent(
  mcpContent: JsonValue[],
  toolName: string,
  image: (block: McpContentBlock, index: number) => ContentBlock = block => ({
    type: 'text',
    text: imageDiagnostic(block, 'this result was not admitted to durable model context'),
  }),
): ContentBlock[] {
  const projected: ContentBlock[] = []
  const text: string[] = []
  const flushText = (): void => {
    if (text.length === 0) return
    projected.push({ type: 'text', text: text.splice(0).join('\n') })
  }

  for (const [index, value] of mcpContent.entries()) {
    if (!isRecord(value)) {
      text.push('[unsupported MCP content block: expected an object]')
      continue
    }
    const block = value as unknown as McpContentBlock
    switch (block.type) {
      case 'text':
        if (block.text !== undefined) text.push(block.text)
        break
      case 'image':
        flushText()
        projected.push(image(block, index))
        break
      case 'resource_link':
        if (block.name === undefined || block.uri === undefined) {
          text.push('[resource link unavailable: the MCP block is missing its name or URI]')
        } else {
          text.push(`Resource link: ${block.name} (${block.uri})`)
        }
        break
      case 'audio':
        text.push(`[audio result unsupported: ${block.mimeType ?? 'unknown media type'}; raw audio data remains available to programmatic callers]`)
        break
      case 'resource':
        text.push('[embedded resource unsupported; raw resource data remains available to programmatic callers]')
        break
      default:
        text.push(`[unsupported MCP content type: ${block.type}]`)
    }
  }
  flushText()
  return projected.length > 0
    ? projected
    : [{ type: 'text', text: `(${toolName} returned no model-visible content)` }]
}
