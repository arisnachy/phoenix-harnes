export interface UiNode {
  readonly type: string
  readonly [key: string]: unknown
}

export interface UiSchema {
  readonly version: 1
  readonly root: UiNode
}

export interface GenerativeUiRenderModel {
  readonly kind: 'generative-ui'
  readonly version: 1
  readonly root: UiNode
}

const FORBIDDEN_KEYS = /^(execute|on[A-Z]|javascript|script|eval|href)$/

function isNode(value: unknown): value is UiNode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const node = value as Record<string, unknown>
  if (typeof node.type !== 'string' || !/^[a-z][a-z0-9-]*$/.test(node.type)) return false
  for (const [key, child] of Object.entries(node)) {
    if (FORBIDDEN_KEYS.test(key) || !isSerializable(child)) return false
    if (key === 'children' && (!Array.isArray(child) || !child.every(isNode))) return false
  }
  return true
}

function isSerializable(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.every(isSerializable)
  if (typeof value !== 'object') return false
  return Object.entries(value as Record<string, unknown>).every(([key, child]) => !FORBIDDEN_KEYS.test(key) && isSerializable(child))
}

export function validateUiSchema(value: unknown): value is UiSchema {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const schema = value as Record<string, unknown>
  return schema.version === 1 && isNode(schema.root)
}

export function renderGenerativeUi(schema: UiSchema): GenerativeUiRenderModel {
  if (!validateUiSchema(schema)) throw new Error('invalid declarative UI schema')
  return Object.freeze({ kind: 'generative-ui', version: 1, root: schema.root })
}
