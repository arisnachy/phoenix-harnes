import type { AssistantMessageEvent } from '@earendil-works/pi-ai'
import type { GenerateOptions, ToolSchema } from '@phoenix-ai/dsh-llm'

const ROOT_COMPOSITION_KEYS = ['oneOf', 'anyOf', 'allOf'] as const
const ROOT_FORBIDDEN_KEYS = new Set(['oneOf', 'anyOf', 'allOf', 'enum', 'const', 'not'])

const OBJECT_ROOT_FUNCTION_APIS = new Set([
  'openai-codex-responses',
  'openai-responses',
  'openai-completions',
  'azure-openai-responses',
])

const MONDAY_TOOL_PREFIX = 'mcp__monday-com-monday-com__'
const MONDAY_ARGUMENT_ENVELOPE_KEY = 'phoenix_arguments'

type JsonObject = Record<string, unknown>

/**
 * Whether this request route must expose function parameters with an object
 * root. Codex enforces this strictly, and the OpenAI-compatible function-tool
 * wires below share that request contract. Keeping the decision at the final
 * provider seam catches MCPs that entered through any registration path while
 * leaving unrelated provider protocols untouched.
 * @param provider - Harness provider route selected for this request.
 * @param api - pi-ai wire protocol used by the resolved model.
 * @returns True when function schemas require the OpenAI/Codex object-root projection.
 */
export function requiresObjectRootFunctionSchemas(provider: string, api: string): boolean {
  return provider === 'openai-codex' || OBJECT_ROOT_FUNCTION_APIS.has(api)
}

/**
 * Whether this exact route needs the PHOENIX Monday compatibility membrane.
 * @param provider - Harness provider route selected for the request.
 * @param api - Resolved pi-ai wire protocol.
 * @returns True only for direct Codex routes.
 */
export function requiresMondayCodexMembrane(provider: string, api: string): boolean {
  return provider === 'openai-codex' || api === 'openai-codex-responses'
}


function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function propertiesOf(schema: JsonObject): JsonObject {
  return isObject(schema.properties) ? schema.properties : {}
}

function mergeProperty(left: unknown, right: unknown): unknown {
  if (left === undefined) return right
  if (right === undefined) return left
  if (JSON.stringify(left) === JSON.stringify(right)) return left

  const variants: unknown[] = []
  const append = (value: unknown): void => {
    if (isObject(value) && Array.isArray(value.anyOf) && Object.keys(value).length === 1) {
      for (const branch of value.anyOf) append(branch)
      return
    }
    if (!variants.some(existing => JSON.stringify(existing) === JSON.stringify(value))) variants.push(value)
  }
  append(left)
  append(right)
  return { anyOf: variants }
}

function compositionBranches(schema: JsonObject): { kind: 'oneOf' | 'anyOf' | 'allOf'; branches: JsonObject[] } | undefined {
  for (const key of ROOT_COMPOSITION_KEYS) {
    const value = schema[key]
    if (!Array.isArray(value)) continue
    const branches = value.filter(isObject)
    if (branches.length > 0) return { kind: key, branches }
  }
  return undefined
}

function mergedRequired(
  schema: JsonObject,
  composition: ReturnType<typeof compositionBranches>,
): string[] {
  const base = new Set(stringArray(schema.required))
  if (composition === undefined || composition.branches.length === 0) return [...base]

  const branchSets = composition.branches.map(branch => new Set(stringArray(branch.required)))
  if (composition.kind === 'allOf') {
    for (const set of branchSets) for (const name of set) base.add(name)
    return [...base]
  }

  const [first, ...rest] = branchSets
  if (first === undefined) return [...base]
  for (const name of first) {
    if (rest.every(set => set.has(name))) base.add(name)
  }
  return [...base]
}

/**
 * OpenAI Codex requires function parameters to have an object root and rejects
 * root-level oneOf/anyOf/allOf/enum/const/not. MCP servers are allowed to
 * advertise broader JSON Schema, so bridge that provider mismatch without
 * mutating the registered ToolRuntime definition.
 *
 * The projection keeps every visible object property from root alternatives.
 * For oneOf/anyOf only requirements common to every branch remain required;
 * the MCP server still performs authoritative validation when the tool runs.
 * @param parameters - Registered JSON Schema arguments from the tool catalog.
 * @returns A Codex-compatible object-root schema, or the original schema when already compatible.
 */
export function normalizeCodexToolParameters(parameters: JsonObject): JsonObject {
  const hasForbiddenRoot = Object.keys(parameters).some(key => ROOT_FORBIDDEN_KEYS.has(key))
  if (parameters.type === 'object' && !hasForbiddenRoot) return parameters

  const composition = compositionBranches(parameters)
  const properties: JsonObject = { ...propertiesOf(parameters) }
  for (const branch of composition?.branches ?? []) {
    for (const [name, value] of Object.entries(propertiesOf(branch))) {
      properties[name] = mergeProperty(properties[name], value)
    }
  }

  const normalized: JsonObject = {}
  for (const [key, value] of Object.entries(parameters)) {
    if (ROOT_FORBIDDEN_KEYS.has(key)) continue
    if (key === 'type' || key === 'properties' || key === 'required') continue
    normalized[key] = value
  }

  normalized.type = 'object'
  if (Object.keys(properties).length > 0 || 'properties' in parameters || composition !== undefined) {
    normalized.properties = properties
  }
  const required = mergedRequired(parameters, composition)
  if (required.length > 0) normalized.required = required
  return normalized
}


/**
 * Limit a narrowly requested Paint turn to its relevant tool family. An
 * unrelated social MCP with an invalid deferred schema must not poison
 * Codex's *entire* function catalog before Computer Use even starts.
 * This is a request-only view: the registry and subsequent turns are intact.
 *
 * @param options - Model request with identified human messages and tool list.
 * @returns Same request, or a scoped shallow copy for native Paint work.
 */
export function scopeCodexToolsForPaint(options: GenerateOptions): GenerateOptions {
  if (options.tools === undefined) return options
  const human = [...options.messages].reverse().find(message =>
    message.role === 'user' && message.source.kind === 'user')
  if (human === undefined) return options
  const text = human.content.map(block =>
    block.type === 'text' ? block.text : '').join(' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
  const paint = /\b(?:paint|mspaint)\b/u.test(text)
    && /\b(?:abre|abrir|entra|entrar|crea|crear|dibuja|dibujo|trazo|carita|usa|open|draw)\b/u.test(text)
    && !/\b(?:publica|publicar|campana|campaign|redes sociales|social media|youtube|instagram|facebook|chrome|navegador)\b/u.test(text)
  if (!paint) return options
  const tools = options.tools.filter((tool) => {
    const name = tool.name.toLowerCase()
    if (/^(?:image_generation|phoenix_3d)$/u.test(name)) return false
    if (!name.startsWith('mcp__')) return true
    return /(?:desktop|windows|filesystem|file-system|powershell|pwsh|shell|computer)/u.test(name)
  })
  return tools.length === options.tools.length ? options : { ...options, tools }
}

function rejectedFunctionSchemaName(detail: string): string | undefined {
  if (!/invalid schema for function/iu.test(detail)
    || !/schema must have type ['"]?object['"]?/iu.test(detail)) return undefined
  return /invalid schema for function ['"]([^'"]+)['"]/iu.exec(detail)?.[1]
}

/**
 * Turn pi-ai's terminal schema rejection event into an exception *before* its
 * stream translator emits a usage/finish event. Without this bridge, a schema
 * error is reported as a finished turn and the adapter never gets a chance to
 * quarantine that malformed function definition.
 *
 * @param events - The original provider event stream.
 * @returns The same provider events unless the provider rejects a function schema.
 */
export async function* surfaceRejectedCodexSchemaEvent(
  events: AsyncIterable<AssistantMessageEvent>,
): AsyncGenerator<AssistantMessageEvent> {
  for await (const event of events) {
    const diagnostic = event.type === 'error' ? event.error.errorMessage
      : event.type === 'done' ? event.message.errorMessage : undefined
    if (typeof diagnostic === 'string' && rejectedFunctionSchemaName(diagnostic) !== undefined) {
      throw new Error(diagnostic)
    }
    yield event
  }
}

/**
 * Contain a provider-rejected function schema without abandoning the whole
 * conversation. A 400 naming one invalid function is a pre-generation
 * rejection, never a completed tool action; the caller may retry once without
 * only that rejected tool. No unrelated tools or durable registry entries
 * are removed.
 *
 * @param options - Original, unmodified model request.
 * @param detail - Provider diagnostic including the exact rejected tool name.
 * @returns A request with only the offending function quarantined, or undefined
 * when the error is not the exact invalid-object-root failure.
 */
export function recoverRejectedCodexFunctionSchema(
  options: GenerateOptions,
  detail: string,
): GenerateOptions | undefined {
  const name = rejectedFunctionSchemaName(detail)
  if (name === undefined || options.tools === undefined) return undefined
  const remaining = options.tools.filter(tool => tool.name !== name)
  if (remaining.length === options.tools.length) return undefined
  return { ...options, tools: remaining }
}

function normalizeTool(tool: ToolSchema): ToolSchema {
  const parameters = normalizeCodexToolParameters(tool.parameters)
  return parameters === tool.parameters ? tool : { ...tool, parameters }
}

/**
 * Request-only Codex projection. Non-Codex providers receive the exact original
 * tool schemas; Codex gets only the compatibility rewrite it requires.
 * @param options - Fully assembled Harness request before provider projection.
 * @returns The original request when no rewrite is needed, otherwise a request with projected tool schemas.
 */
export function normalizeCodexToolSchemas(options: GenerateOptions): GenerateOptions {
  if (options.tools === undefined || options.tools.length === 0) return options

  let changed = false
  const tools = options.tools.map((tool) => {
    const normalized = normalizeTool(tool)
    if (normalized !== tool) changed = true
    return normalized
  })
  return changed ? { ...options, tools } : options
}

function isMondayToolName(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(MONDAY_TOOL_PREFIX)
}

function mondayEnvelopeParameters(): JsonObject {
  return {
    type: 'object',
    properties: {
      [MONDAY_ARGUMENT_ENVELOPE_KEY]: {
        type: 'object',
        description: 'Exact argument object forwarded unchanged to the Monday MCP tool.',
        additionalProperties: true,
      },
    },
    required: [MONDAY_ARGUMENT_ENVELOPE_KEY],
    additionalProperties: false,
  }
}

function isMondayEnvelopeParameters(parameters: JsonObject): boolean {
  const properties = propertiesOf(parameters)
  return parameters.type === 'object'
    && isObject(properties[MONDAY_ARGUMENT_ENVELOPE_KEY])
    && stringArray(parameters.required).includes(MONDAY_ARGUMENT_ENVELOPE_KEY)
}

function mondayCompatibilityDescription(description: unknown, parameters: JsonObject): string {
  const base = typeof description === 'string' ? description.trim() : ''
  const normalized = normalizeCodexToolParameters(parameters)
  const knownKeys = Object.keys(propertiesOf(normalized)).sort()
  const compatibility = [
    'PHOENIX Monday compatibility: put the exact tool arguments inside "phoenix_arguments".',
    knownKeys.length > 0 ? `Known Monday argument keys: ${knownKeys.join(', ')}.` : '',
  ].filter(Boolean).join(' ')
  return base.length > 0 ? `${base} ${compatibility}` : compatibility
}

/**
 * Replace every Monday tool schema with one stable Codex-safe envelope while
 * keeping the original tool name and execution identity.
 *
 * The MCP client accepts the envelope and unwraps it immediately before the
 * remote tools/call request. This makes the compatibility rule server-wide:
 * newly-added Monday tools cannot break Codex merely by advertising another
 * root union or unsupported JSON-Schema keyword.
 * @param options - Model request after generic schema normalization.
 * @returns The original request when no Monday tool is present, otherwise a copy with wrapped Monday schemas.
 */
export function applyMondayCodexMembrane(options: GenerateOptions): GenerateOptions {
  if (options.tools === undefined || options.tools.length === 0) return options
  let changed = false
  const tools = options.tools.map((tool) => {
    if (!isMondayToolName(tool.name) || isMondayEnvelopeParameters(tool.parameters)) return tool
    changed = true
    return {
      ...tool,
      description: mondayCompatibilityDescription(tool.description, tool.parameters),
      parameters: mondayEnvelopeParameters(),
    }
  })
  return changed ? { ...options, tools } : options
}


function normalizePayloadToolEntry(value: unknown, mondayMembrane: boolean): unknown {
  if (!isObject(value)) return value

  // pi-ai has two relevant shapes:
  // 1) provider-wire function tools: { type: 'function', name, parameters }
  // 2) pre-wire context tools:       { name, description, parameters }
  //
  // The second shape matters because pi-ai may validate context tools before
  // onPayload runs. The Monday membrane must therefore exist both before and
  // after provider encoding.
  const isWireFunction = value.type === 'function'
  const isMcpContextTool = typeof value.name === 'string' && value.name.startsWith('mcp__')
  // Some MCP/tool-search projections expose inputSchema or input_schema
  // instead of the provider wire's parameters field. Never forward that
  // root union unchanged into an OpenAI/Codex function definition.
  const alternateSchema = isObject(value.inputSchema) ? value.inputSchema
    : isObject(value.input_schema) ? value.input_schema : undefined
  if ((isWireFunction || isMcpContextTool)
    && !isObject(value.parameters) && alternateSchema !== undefined) {
    const { inputSchema: _inputSchema, input_schema: _input_schema, ...rest } = value
    return { ...rest, parameters: normalizeCodexToolParameters(alternateSchema) }
  }
  if ((isWireFunction || isMcpContextTool) && isObject(value.parameters)) {
    if (mondayMembrane && isMondayToolName(value.name)) {
      if (isMondayEnvelopeParameters(value.parameters)) return value
      return {
        ...value,
        description: mondayCompatibilityDescription(value.description, value.parameters),
        parameters: mondayEnvelopeParameters(),
      }
    }
    const parameters = normalizeCodexToolParameters(value.parameters)
    return parameters === value.parameters ? value : { ...value, parameters }
  }

  if (isObject(value.function)
    && typeof value.function.name === 'string'
    && (isWireFunction || value.function.name.startsWith('mcp__'))
    && isObject(value.function.parameters)) {
    if (mondayMembrane && isMondayToolName(value.function.name)) {
      if (isMondayEnvelopeParameters(value.function.parameters)) return value
      return {
        ...value,
        function: {
          ...value.function,
          description: mondayCompatibilityDescription(value.function.description, value.function.parameters),
          parameters: mondayEnvelopeParameters(),
        },
      }
    }
    const parameters = normalizeCodexToolParameters(value.function.parameters)
    if (parameters === value.function.parameters) return value
    return {
      ...value,
      function: {
        ...value.function,
        parameters,
      },
    }
  }

  return value
}

function normalizePayloadTree(value: unknown, mondayMembrane: boolean): unknown {
  if (Array.isArray(value)) {
    let changed = false
    const normalized = value.map((entry) => {
      const next = normalizePayloadTree(entry, mondayMembrane)
      if (next !== entry) changed = true
      return next
    })
    return changed ? normalized : value
  }
  if (!isObject(value)) return value

  // Normalize a function-tool definition wherever pi-ai (or a future provider
  // adapter) nests it, then keep walking because tool catalogs can themselves
  // contain deferred/nested tool lists.
  const tool = normalizePayloadToolEntry(value, mondayMembrane)
  const source = isObject(tool) ? tool : value
  let changed = tool !== value
  let normalized: JsonObject | undefined

  for (const [key, child] of Object.entries(source)) {
    const next = normalizePayloadTree(child, mondayMembrane)
    if (next === child) continue
    normalized ??= { ...source }
    normalized[key] = next
    changed = true
  }

  if (normalized !== undefined) return normalized
  return changed ? source : value
}

/**
 * Final-wire defense for OpenAI-compatible payloads.
 *
 * Phoenix normalizes ToolRuntime definitions before pi-ai sees them, but pi-ai
 * may rebuild or defer provider tool payloads in nested structures. This hook
 * therefore enforces the function-schema invariant recursively over the final
 * JSON request body instead of depending on a fixed list of payload paths.
 *
 * Only objects that are actual function-tool entries are rewritten; ordinary
 * conversation payloads and non-function tools retain identity when unchanged.
 *
 * @param payload - Provider request body produced by pi-ai.
 * @param mondayMembrane - Whether every Monday tool should use the local PHOENIX argument envelope.
 * @returns The original payload when already compatible, otherwise a copy with
 * every nested function-tool schema projected to Codex's object-root contract.
 */
export function normalizeOpenAiFunctionToolPayload(payload: unknown, mondayMembrane = false): unknown {
  return normalizePayloadTree(payload, mondayMembrane)
}
