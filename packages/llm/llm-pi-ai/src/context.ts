/**
 * Harness request-history conversion into pi-ai's Context vocabulary.
 *
 * @module dsh-llm-pi-ai/context
 */

import { CallId, contentHasFile, contentHasImage, LlmError, offloadRequestImagesWithPolicy, requestImageHandleText } from '@phoenix-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@phoenix-ai/dsh-llm'
import type {
  AttachmentId,
  AttachmentStore,
  FileAttachmentRef,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  StoredFileAttachment,
} from '@phoenix-ai/dsh-attachment'
import { projectFileContent } from '@phoenix-ai/dsh-attachment'
import type { Context as PiContext, ImageContent, Message as PiMessage, TextContent, Tool as PiTool } from '@earendil-works/pi-ai'
import { toPiAssistant } from './replay.ts'
import {
  DEFAULT_MAX_INLINE_FILE_BYTES,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
} from './config.ts'

const ESTIMATED_CHARS_PER_TOKEN = 4
const ESTIMATED_IMAGE_CHARS = 4800
const PI_CONTEXT_SAFETY_TOKENS = 4096
const MAX_RESPONSE_RESERVE_TOKENS = 4096
const PRESSURE_TOOL_DESCRIPTION_MAX_CHARS = 160
const PRESSURE_SKILL_CATALOG_MAX_CHARS = 12_000
const SCHEMA_DECORATION_KEYS = new Set([
  'description',
  'title',
  '$comment',
  'examples',
  'example',
  'default',
])

/** JSON stringify that cannot fail request budgeting on an exotic schema value. */
function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

/** Reused schemas and content arrays should be sized once, not on every preflight pass. */
const JSON_CHAR_LENGTH_CACHE = new WeakMap<object, number>()
const CONTENT_BLOCKS_CHAR_CACHE = new WeakMap<object, number>()

function safeJsonCharLength(value: unknown): number {
  if (typeof value !== 'object' || value === null) return safeJsonStringify(value).length
  const cached = JSON_CHAR_LENGTH_CACHE.get(value)
  if (cached !== undefined) return cached
  const length = safeJsonStringify(value).length
  JSON_CHAR_LENGTH_CACHE.set(value, length)
  return length
}

function estimateToolsChars(tools: NonNullable<GenerateOptions['tools']>): number {
  let chars = 2
  for (const tool of tools) chars += safeJsonCharLength(tool) + 1
  return chars
}

function estimateContentBlocksChars(blocks: readonly ContentBlock[]): number {
  const cached = CONTENT_BLOCKS_CHAR_CACHE.get(blocks)
  if (cached !== undefined) return cached
  let chars = 0
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        chars += block.text.length
        break
      case 'image':
        chars += ESTIMATED_IMAGE_CHARS
        break
      case 'file':
        chars += Math.min(block.attachment.bytes, DEFAULT_MAX_INLINE_FILE_BYTES)
        break
      case 'tool-call':
        chars += block.name.length + block.arguments.length
        break
      case 'tool-result':
        chars += estimateContentBlocksChars(block.content)
        break
      default:
        break
    }
  }
  CONTENT_BLOCKS_CHAR_CACHE.set(blocks, chars)
  return chars
}

/**
 * Conservative request-size estimate using the same 4-chars/token convention
 * pi-ai 0.82.x uses before it clamps maxTokens to remaining context.
 * @param options - fully assembled harness request before adapter conversion.
 * @returns estimated request-context tokens including system, messages, and tool schemas.
 */
export function estimateGenerateOptionsTokens(options: GenerateOptions): number {
  let chars = options.system?.length ?? 0
  for (const message of options.messages) chars += estimateContentBlocksChars(message.content)
  if (options.tools !== undefined && options.tools.length > 0) {
    chars += estimateToolsChars(options.tools)
  }
  return Math.ceil(chars / ESTIMATED_CHARS_PER_TOKEN)
}

const COMPACT_SCHEMA_CACHE = new WeakMap<object, unknown>()

function compactSchemaForPressure(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const cached = COMPACT_SCHEMA_CACHE.get(value)
  if (cached !== undefined) return cached
  if (Array.isArray(value)) {
    const compacted = value.map(compactSchemaForPressure)
    COMPACT_SCHEMA_CACHE.set(value, compacted)
    return compacted
  }
  const compacted: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (SCHEMA_DECORATION_KEYS.has(key)) continue
    compacted[key] = compactSchemaForPressure(child)
  }
  COMPACT_SCHEMA_CACHE.set(value, compacted)
  return compacted
}

function boundedToolDescription(value: string): string {
  if (value.length <= PRESSURE_TOOL_DESCRIPTION_MAX_CHARS) return value
  return value.slice(0, PRESSURE_TOOL_DESCRIPTION_MAX_CHARS - 1).trimEnd() + '…'
}

type GenerateTool = NonNullable<GenerateOptions['tools']>[number]

interface CachedPressureTool {
  readonly description: string
  readonly parameters: unknown
  readonly compacted: GenerateTool
}

const COMPACT_TOOL_CACHE = new WeakMap<object, CachedPressureTool>()

function compactToolForPressure(tool: GenerateTool): GenerateTool {
  const cached = COMPACT_TOOL_CACHE.get(tool)
  if (cached !== undefined
    && cached.description === tool.description
    && cached.parameters === tool.parameters) return cached.compacted
  const compacted: GenerateTool = {
    name: tool.name,
    description: boundedToolDescription(tool.description),
    parameters: compactSchemaForPressure(tool.parameters) as Record<string, unknown>,
  }
  COMPACT_TOOL_CACHE.set(tool, {
    description: tool.description,
    parameters: tool.parameters,
    compacted,
  })
  return compacted
}

function compactToolsForPressure(
  tools: NonNullable<GenerateOptions['tools']>,
): NonNullable<GenerateOptions['tools']> {
  return tools.map(compactToolForPressure)
}

function compactSkillCatalogMessage(message: Message): Message {
  const source = message.source as unknown as { kind?: unknown; entries?: unknown }
  if (source.kind !== 'skill-catalog' || !Array.isArray(source.entries)) return message
  const names = source.entries.flatMap((entry): string[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const name = (entry as { name?: unknown }).name
    return typeof name === 'string' && name.length > 0 ? [name] : []
  })
  if (names.length === 0) return message

  const lines: string[] = []
  let chars = 0
  for (const name of names) {
    const line = '- `' + name + '`'
    if (chars + line.length + 1 > PRESSURE_SKILL_CATALOG_MAX_CHARS) break
    lines.push(line)
    chars += line.length + 1
  }
  const omitted = names.length - lines.length
  const text = [
    '<system-reminder>',
    'Available skills (compact index used because this model has limited request context):',
    '<available_skills>',
    ...lines,
    '</available_skills>',
    ...(omitted > 0 ? [String(omitted) + ' additional skills are omitted from this compact index.'] : []),
    'Call the `skill` tool with an exact listed name when one clearly applies. Full skill instructions are loaded only on demand.',
    '</system-reminder>',
  ].join('\n')
  return { ...message, content: [{ type: 'text', text }] }
}

function compactAuxiliaryContextForPressure(options: GenerateOptions): GenerateOptions {
  return {
    ...options,
    messages: options.messages.map(compactSkillCatalogMessage),
    ...(options.tools === undefined ? {} : { tools: compactToolsForPressure(options.tools) }),
  }
}


const CORE_PRESSURE_TOOL = /(?:skill|read|write|edit|search|grep|bash|pwsh|shell|computer|browser|web|todo|subagent)/iu

function toolNamesUsedInMessages(messages: readonly Message[]): Set<string> {
  const names = new Set<string>()
  const visit = (blocks: readonly ContentBlock[]): void => {
    for (const block of blocks) {
      if (block.type === 'tool-call') names.add(block.name)
      else if (block.type === 'tool-result') visit(block.content)
    }
  }
  for (const message of messages) visit(message.content)
  return names
}

function latestUserText(messages: readonly Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user' || message.source.kind === 'tool') continue
    return message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join(' ')
      .toLowerCase()
  }
  return ''
}

function selectToolsForPressureBudget(options: GenerateOptions, inputBudgetTokens: number): GenerateOptions {
  const tools = options.tools ?? []
  if (tools.length === 0) return options
  const withoutTools: GenerateOptions = { ...options, tools: [] }
  const baseTokens = estimateGenerateOptionsTokens(withoutTools)
  const availableChars = Math.max(0, (inputBudgetTokens - baseTokens) * ESTIMATED_CHARS_PER_TOKEN)
  if (availableChars <= 2) return withoutTools

  const query = latestUserText(options.messages)
  const used = toolNamesUsedInMessages(options.messages)
  const words = new Set(query.match(/[\p{L}\p{N}_-]{3,}/gu) ?? [])
  const ranked = tools.map((tool, index) => {
    const name = tool.name.toLowerCase()
    const description = tool.description.toLowerCase()
    let score = used.has(tool.name) ? 10_000 : 0
    if (query.includes(name)) score += 2_000
    if (CORE_PRESSURE_TOOL.test(tool.name)) score += 500
    for (const word of words) {
      if (name.includes(word)) score += 200
      else if (description.includes(word)) score += 20
    }
    return { tool, index, score, chars: safeJsonCharLength(tool) + 1 }
  }).sort((left, right) => right.score - left.score || left.index - right.index)

  const selected: { tool: NonNullable<GenerateOptions['tools']>[number]; index: number }[] = []
  let chars = 2
  for (const candidate of ranked) {
    if (chars + candidate.chars > availableChars) continue
    selected.push({ tool: candidate.tool, index: candidate.index })
    chars += candidate.chars
  }
  selected.sort((left, right) => left.index - right.index)
  return { ...options, tools: selected.map(entry => entry.tool) }
}

/** Result of fitting one request to a model's safe input budget. */
export interface ContextBudgetFit {
  /** Request representation to convert and send. */
  options: GenerateOptions
  /** Estimated input tokens after any request-only compaction. */
  estimatedTokens: number
  /** Maximum estimated input that still preserves pi-ai safety plus reply room. */
  inputBudgetTokens: number
  /** Whether request-only compaction was applied. */
  compacted: boolean
}

/**
 * Reserve useful answer room before pi-ai applies its own context clamp.
 *
 * This does not mutate durable conversation state. Under pressure it only
 * compacts model-facing skill-catalog prose and schema documentation; tool
 * names, argument structure, user messages, system instructions and history
 * remain intact.
 * @param options - fully assembled request before provider conversion.
 * @param contextWindow - model context capacity used by pi-ai for request clamping.
 * @param desiredMaxOutput - caller/model output budget before context-based clamping.
 * @returns the request representation to send plus its estimated safe-budget facts.
 */
export function fitGenerateOptionsToContext(
  options: GenerateOptions,
  contextWindow: number,
  desiredMaxOutput: number,
): ContextBudgetFit {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    return {
      options,
      estimatedTokens: estimateGenerateOptionsTokens(options),
      inputBudgetTokens: Number.POSITIVE_INFINITY,
      compacted: false,
    }
  }
  const responseReserve = Math.min(
    Math.max(0, Math.floor(desiredMaxOutput)),
    MAX_RESPONSE_RESERVE_TOKENS,
  )
  const inputBudgetTokens = Math.max(
    1,
    Math.floor(contextWindow) - PI_CONTEXT_SAFETY_TOKENS - responseReserve,
  )
  const estimatedTokens = estimateGenerateOptionsTokens(options)
  if (estimatedTokens <= inputBudgetTokens) {
    return { options, estimatedTokens, inputBudgetTokens, compacted: false }
  }

  const compactedOptions = compactAuxiliaryContextForPressure(options)
  const compactedTokens = estimateGenerateOptionsTokens(compactedOptions)
  if (compactedTokens <= inputBudgetTokens) {
    return {
      options: compactedOptions,
      estimatedTokens: compactedTokens,
      inputBudgetTokens,
      compacted: true,
    }
  }

  const budgetedOptions = selectToolsForPressureBudget(compactedOptions, inputBudgetTokens)
  return {
    options: budgetedOptions,
    estimatedTokens: estimateGenerateOptionsTokens(budgetedOptions),
    inputBudgetTokens,
    compacted: true,
  }
}
/** Join the text blocks of a harness message. */
function flattenText(message: Message): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}


/** Flatten text recursively inside one tool result. */
function toolResultText(blocks: readonly ContentBlock[]): string {
  return blocks.map(block => block.type === 'text'
    ? block.text
    : block.type === 'tool-result' ? toolResultText(block.content) : '').join('')
}

/** Reject image roles that pi-ai cannot replay before request-size offloading can replace them. */
function assertSupportedImageRoles(messages: readonly Message[]): void {
  for (const message of messages) {
    if (message.role !== 'user' && (contentHasImage(message.content) || contentHasFile(message.content))) {
      throw new LlmError(
        `pi-ai cannot represent attachment content in an in-history ${message.role} message`,
        'UNSUPPORTED_CONTENT',
      )
    }
  }
}

async function userContent(
  blocks: readonly ContentBlock[],
  requestImages: ReadonlyMap<AttachmentId, RequestImageAttachment>,
  requestFiles: ReadonlyMap<AttachmentId, StoredFileAttachment>,
  maxInlineFileBytes: number,
): Promise<string | (TextContent | ImageContent)[]> {
  const content: (TextContent | ImageContent)[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) content.push({ type: 'text', text: block.text })
        break
      case 'image': {
        const version = requestImages.get(block.attachment.attachmentId) as RequestImageAttachment
        content.push({ type: 'text', text: requestImageHandleText(version) })
        content.push({
          type: 'image',
          data: Buffer.from(version.data).toString('base64'),
          mimeType: version.mediaType,
        })
        break
      }
      case 'file': {
        const stored = requestFiles.get(block.attachment.attachmentId)
        if (stored === undefined
          || stored.ref.attachmentId !== block.attachment.attachmentId
          || stored.ref.bytes !== stored.data.byteLength
          || stored.ref.bytes !== block.attachment.bytes) {
          throw new LlmError(
            `pi-ai request file ${block.attachment.attachmentId} was not prepared.`,
            'INVALID_REQUEST',
          )
        }
        const name = safeFileName(block.attachment)
        let projection
        try {
          projection = projectFileContent(block.attachment, stored.data, maxInlineFileBytes)
        } catch (error: unknown) {
          throw new LlmError(
            `pi-ai request file "${name}" is not valid UTF-8 text.`,
            'UNSUPPORTED_CONTENT',
            { cause: error },
          )
        }
        if (projection === undefined) {
          content.push({
            type: 'text',
            text: `Attached binary file "${name}" (${block.attachment.mediaType}, ${block.attachment.bytes} bytes).\n`,
          })
          break
        }
        content.push({
          type: 'text',
          text: `Attached file "${name}" (${block.attachment.mediaType}, ${block.attachment.bytes} bytes):\n`
            + `${projection.text}${projection.truncated ? `\n[file content truncated after ${maxInlineFileBytes} bytes]` : ''}\n`,
        })
        break
      }
      case 'tool-result':
        {
          const nested = await userContent(block.content, requestImages, requestFiles, maxInlineFileBytes)
          if (typeof nested === 'string') {
            if (nested.length > 0) content.push({ type: 'text', text: nested })
          } else {
            content.push(...nested)
          }
        }
        break
      default:
        // Other merge-extensible blocks are not user-input vocabulary for pi-ai.
        break
    }
  }
  if (content.every(block => block.type === 'text')) return content.map(block => block.text).join('')
  return content
}

/** Strip control characters from a model-visible attachment name. */
function safeFileName(ref: FileAttachmentRef): string {
  const name = ref.name?.replace(/[\u0000-\u001f\u007f]/gu, '').trim()
  return name === undefined || name.length === 0
    ? `attachment-${String(ref.attachmentId).slice(-8)}`
    : name.slice(0, 255)
}

function collectImageRefs(
  blocks: readonly ContentBlock[],
  refs: Map<AttachmentId, ImageAttachmentRef>,
): void {
  for (const block of blocks) {
    if (block.type === 'image') refs.set(block.attachment.attachmentId, block.attachment)
    else if (block.type === 'tool-result') collectImageRefs(block.content, refs)
  }
}

async function prepareRequestImages(
  messages: readonly Message[],
  attachments: AttachmentStore,
  policy: ImageRequestPolicy,
  signal?: AbortSignal,
): Promise<Map<AttachmentId, RequestImageAttachment>> {
  const refs = new Map<AttachmentId, ImageAttachmentRef>()
  for (const message of messages) collectImageRefs(message.content, refs)
  const orderedRefs = [...refs.values()]
  const prepared = await Promise.all(orderedRefs.map(
    ref => attachments.readImageRequest(ref, policy, signal),
  ))
  const versions = new Map<AttachmentId, RequestImageAttachment>()
  for (const [index, ref] of orderedRefs.entries()) {
    versions.set(ref.attachmentId, prepared[index] as RequestImageAttachment)
  }
  return versions
}

/** Collect durable file references in request and nested tool-result order. */
function collectFileRefs(
  blocks: readonly ContentBlock[],
  refs: Map<AttachmentId, FileAttachmentRef>,
): void {
  for (const block of blocks) {
    if (block.type === 'file') refs.set(block.attachment.attachmentId, block.attachment)
    else if (block.type === 'tool-result') collectFileRefs(block.content, refs)
  }
}

/** Resolve every file that the pi-ai request will project into model text. */
async function prepareRequestFiles(
  messages: readonly Message[],
  attachments: AttachmentStore,
  signal?: AbortSignal,
): Promise<Map<AttachmentId, StoredFileAttachment>> {
  const refs = new Map<AttachmentId, FileAttachmentRef>()
  for (const message of messages) collectFileRefs(message.content, refs)
  const entries = await Promise.all([...refs.values()].map(async (ref) => {
    const stored = await attachments.readFile(ref, signal)
    return [ref.attachmentId, stored] as const
  }))
  return new Map(entries)
}

function toolsOf(options: GenerateOptions): PiTool[] | undefined {
  return options.tools?.map(tool => ({
    name: tool.name,
    description: tool.description,
    // ToolSchema.parameters is a JSON Schema object; pi-ai's TSchema
    // (TypeBox) is structurally JSON Schema, so it assigns directly.
    parameters: tool.parameters,
  }))
}

/** Assemble the request-level pi-ai context envelope shared by both conversion paths. */
function piContext(options: GenerateOptions, messages: PiMessage[]): PiContext {
  const tools = toolsOf(options)
  return {
    ...options.system !== undefined ? { systemPrompt: options.system } : {},
    messages,
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
  }
}

function textOnlyContext(options: GenerateOptions, onReplayDegrade?: (reason: string) => void): PiContext {
  const toolNames = new Map<CallId, string>()
  const messages: PiMessage[] = []
  for (const message of options.messages) {
    if (contentHasImage(message.content) || contentHasFile(message.content)) {
      throw new LlmError('pi-ai attachment conversion requires the durable attachment service', 'UNSUPPORTED_CONTENT')
    }
    if (message.role === 'system') {
      messages.push({ role: 'user', content: flattenText(message), timestamp: 0 })
      continue
    }
    if (message.role === 'assistant') {
      const assistant = toPiAssistant(message, onReplayDegrade)
      for (const block of assistant.content) if (block.type === 'toolCall') toolNames.set(CallId(block.id), block.name)
      messages.push(assistant)
      continue
    }
    const text = flattenText(message)
    const results = message.content.filter(block => block.type === 'tool-result')
    if (text.length > 0 || results.length === 0) messages.push({ role: 'user', content: text, timestamp: 0 })
    for (const result of results) {
      messages.push({
        role: 'toolResult',
        toolCallId: result.toolCallId,
        toolName: toolNames.get(result.toolCallId) ?? 'unknown',
        content: [{
          type: 'text',
          text: toolResultText(result.content) || '(no output)',
        }],
        isError: result.isError ?? false,
        timestamp: 0,
      })
    }
  }
  return piContext(options, messages)
}

/**
 * Convert text-only harness history to a synchronous pi-ai Context. Tool
 * result names are recovered from preceding assistant tool calls.
 * @param options - the harness request; `options.system` maps to pi-ai's single `systemPrompt` slot.
 * @param attachments - absent; selects the synchronous conversion.
 * @param onReplayDegrade - forwarded to {@link toPiAssistant} for each assistant message.
 * @returns the pi-ai context; `tools` is omitted when the request declares none.
 */
export function toPiContext(
  options: GenerateOptions,
  attachments?: undefined,
  onReplayDegrade?: (reason: string) => void,
): PiContext
/**
 * Convert harness history to a pi-ai Context while resolving durable images.
 * Tool result names are recovered from preceding assistant tool calls. When
 * the accumulated base64 image payload exceeds `maxRequestImageBytes`, the
 * oldest images are replaced by text placeholders until the request fits, so
 * an image-heavy session keeps clearing gateway request-size caps.
 * @param options - the harness request; `options.system` maps to pi-ai's single `systemPrompt` slot.
 * @param attachments - durable byte resolver for image references.
 * @param onReplayDegrade - forwarded to {@link toPiAssistant} for each assistant message.
 * @param maxRequestImageBytes - request-level bound on base64-encoded image payload; omission leaves every image in place.
 * @param requestImagePolicy - route pixel and raw encoded-byte budgets.
 * @param maxInlineFileBytes - request-level bound for decoded text file attachments.
 * @returns the asynchronously resolved pi-ai context.
 */
export function toPiContext(
  options: GenerateOptions,
  attachments: AttachmentStore,
  onReplayDegrade?: (reason: string) => void,
  maxRequestImageBytes?: number,
  requestImagePolicy?: ImageRequestPolicy,
  maxInlineFileBytes?: number,
): Promise<PiContext>
export function toPiContext(
  options: GenerateOptions,
  attachments?: AttachmentStore,
  onReplayDegrade?: (reason: string) => void,
  maxRequestImageBytes?: number,
  requestImagePolicy?: ImageRequestPolicy,
  maxInlineFileBytes?: number,
): PiContext | Promise<PiContext> {
  return attachments === undefined
    ? textOnlyContext(options, onReplayDegrade)
    : toPiContextWithImages(options, attachments, onReplayDegrade, maxRequestImageBytes, requestImagePolicy, maxInlineFileBytes)
}

async function toPiContextWithImages(
  options: GenerateOptions,
  attachments: AttachmentStore,
  onReplayDegrade?: (reason: string) => void,
  maxRequestImageBytes?: number,
  requestImagePolicy: ImageRequestPolicy = {
    maxPixels: DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    maxBytes: DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  },
  maxInlineFileBytes = DEFAULT_MAX_INLINE_FILE_BYTES,
): Promise<PiContext> {
  assertSupportedImageRoles(options.messages)
  const requestMessages = offloadRequestImagesWithPolicy(options.messages, {
    representation: 'base64',
    ...maxRequestImageBytes === undefined ? {} : { maxBytes: maxRequestImageBytes },
    byteQuantum: 1,
    byteLength: ref => Math.min(ref.bytes, requestImagePolicy.maxBytes),
  })
  const requestImages = await prepareRequestImages(requestMessages, attachments, requestImagePolicy, options.signal)
  const requestFiles = await prepareRequestFiles(requestMessages, attachments, options.signal)
  const exactMessages = offloadRequestImagesWithPolicy(requestMessages, {
    representation: 'base64',
    ...maxRequestImageBytes === undefined ? {} : { maxBytes: maxRequestImageBytes },
    byteQuantum: 1,
    byteLength: ref => (requestImages.get(ref.attachmentId) as RequestImageAttachment).bytes,
  })
  const toolNames = new Map<CallId, string>()
  const messages: PiMessage[] = []

  for (const message of exactMessages) {
    if (message.role === 'system') {
      // pi-ai has a single systemPrompt slot; in-history system messages are
      // folded into user messages to preserve order (rare in practice — the
      // harness sends the system prompt via options.system).
      messages.push({ role: 'user', content: flattenText(message), timestamp: 0 })
      continue
    }
    if (message.role === 'assistant') {
      const assistant = toPiAssistant(message, onReplayDegrade)
      for (const block of assistant.content) {
        if (block.type === 'toolCall') toolNames.set(CallId(block.id), block.name)
      }
      messages.push(assistant)
      continue
    }
    // user role: text + tool results (each result becomes its own message).
    const regular = message.content.filter(block => block.type !== 'tool-result')
    const content = await userContent(regular, requestImages, requestFiles, maxInlineFileBytes)
    const results = message.content.filter((block): block is Extract<ContentBlock, { type: 'tool-result' }> => (
      block.type === 'tool-result'
    ))
    if (content.length > 0 || results.length === 0) {
      messages.push({ role: 'user', content, timestamp: 0 })
    }
    for (const result of results) {
      const resultContent = await userContent(result.content, requestImages, requestFiles, maxInlineFileBytes)
      messages.push({
        role: 'toolResult',
        toolCallId: result.toolCallId,
        toolName: toolNames.get(result.toolCallId) ?? 'unknown',
        content: typeof resultContent === 'string'
          ? [{ type: 'text', text: resultContent || '(no output)' }]
          : resultContent,
        isError: result.isError ?? false,
        timestamp: 0,
      })
    }
  }

  return piContext(options, messages)
}
