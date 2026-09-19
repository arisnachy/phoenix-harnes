import type { GenerateOptions, ToolSchema } from '@phoenix-ai/dsh-llm'

const ROOT_COMPOSITION_KEYS = ['oneOf', 'anyOf', 'allOf'] as const
const ROOT_FORBIDDEN_KEYS = new Set(['oneOf', 'anyOf', 'allOf', 'enum', 'const', 'not'])

const OBJECT_ROOT_FUNCTION_APIS = new Set([
  'openai-codex-responses',
  'openai-responses',
  'openai-completions',
  'azure-openai-responses',
])

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


function normalizePayloadToolEntry(value: unknown): unknown {
  if (!isObject(value)) return value

  // pi-ai has two relevant shapes:
  // 1) provider-wire function tools: { type: 'function', name, parameters }
  // 2) pre-wire context tools:       { name, description, parameters }
  //
  // The second shape is important because pi-ai may validate/transform context
  // tools before onPayload runs. Monday's MCP schema must therefore be safe
  // before it ever enters provider encoding, not only after the payload exists.
  const isWireFunction = value.type === 'function'
  const isMcpContextTool = typeof value.name === 'string' && value.name.startsWith('mcp__')
  if ((isWireFunction || isMcpContextTool) && isObject(value.parameters)) {
    const parameters = normalizeCodexToolParameters(value.parameters)
    return parameters === value.parameters ? value : { ...value, parameters }
  }

  if (isWireFunction && isObject(value.function) && isObject(value.function.parameters)) {
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

function normalizePayloadTree(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false
    const normalized = value.map((entry) => {
      const next = normalizePayloadTree(entry)
      if (next !== entry) changed = true
      return next
    })
    return changed ? normalized : value
  }
  if (!isObject(value)) return value

  // Normalize a function-tool definition wherever pi-ai (or a future provider
  // adapter) nests it, then keep walking because tool catalogs can themselves
  // contain deferred/nested tool lists.
  const tool = normalizePayloadToolEntry(value)
  const source = isObject(tool) ? tool : value
  let changed = tool !== value
  let normalized: JsonObject | undefined

  for (const [key, child] of Object.entries(source)) {
    const next = normalizePayloadTree(child)
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
 * @returns The original payload when already compatible, otherwise a copy with
 * every nested function-tool schema projected to Codex's object-root contract.
 */
export function normalizeOpenAiFunctionToolPayload(payload: unknown): unknown {
  return normalizePayloadTree(payload)
}
