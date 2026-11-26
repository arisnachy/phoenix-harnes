/** Session-owned, fixture-tested numeric tools. No eval, shell, I/O, or new permissions. */
import { executeNumericRecipe, verifyNumericRecipe } from './amplifier.ts'

type CheckedRecipe = ReturnType<typeof verifyNumericRecipe>
interface Entry {
  id: string
  title: string
  recipe: CheckedRecipe
}
interface Scope {
  expiresAt: number
  tools: Map<string, Entry>
}

export class SessionToolFactory {
  private readonly scopes = new Map<string, Scope>()

  private scope(key: string, create: boolean): Scope | undefined {
    if (!/^[A-Za-z0-9_:-]{1,128}$/u.test(key)) throw Error('FACTORY_SCOPE_REQUIRED')
    const now = Date.now()
    for (const [id, value] of this.scopes) {
      if (value.expiresAt <= now) this.scopes.delete(id)
    }
    let scope = this.scopes.get(key)
    if (scope === undefined && create) {
      if (this.scopes.size >= 64) throw Error('FACTORY_SCOPE_LIMIT')
      scope = { expiresAt: now + 24 * 60 * 60 * 1000, tools: new Map() }
      this.scopes.set(key, scope)
    }
    return scope
  }

  private describe(entry: Entry) {
    return {
      id: entry.id, title: entry.title, inputs: entry.recipe.program.inputs,
      outputs: entry.recipe.program.steps.map(step => step.output),
      fixturesPassed: entry.recipe.passed, deterministic: true,
      externalValidation: false, persistent: false, externalPermissions: false,
    }
  }

  execute(key: string, operation: string, raw: string): unknown {
    if (Buffer.byteLength(raw, 'utf8') > 8192) throw Error('FACTORY_INPUT_LIMIT')
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('FACTORY_INPUT')
    const data = value as Record<string, unknown>
    const scope = this.scope(key, operation === 'create')
    if (operation === 'list') {
      if (Object.keys(data).length !== 0) throw Error('FACTORY_FIELDS')
      return { tools: [...(scope?.tools.values() ?? [])].map(entry => this.describe(entry)) }
    }
    const id = data.id
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/u.test(id)) throw Error('FACTORY_ID')
    if (operation === 'create') {
      if (Object.keys(data).some(k => !['id', 'title', 'program', 'fixtures'].includes(k))
        || typeof data.title !== 'string' || data.title.trim().length === 0
        || data.title.length > 100) throw Error('FACTORY_FIELDS')
      const recipe = verifyNumericRecipe({ program: data.program, fixtures: data.fixtures })
      const entry: Entry = { id, title: data.title.trim(), recipe }
      const existing = scope!.tools.get(id)
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(entry)) throw Error('FACTORY_ID_EXISTS')
        return { ...this.describe(existing), reused: true }
      }
      if (scope!.tools.size >= 16) throw Error('FACTORY_TOOL_LIMIT')
      scope!.tools.set(id, entry)
      return { ...this.describe(entry), reused: false }
    }
    if (operation === 'remove') {
      if (Object.keys(data).some(k => k !== 'id')) throw Error('FACTORY_FIELDS')
      return { id, removed: scope?.tools.delete(id) ?? false }
    }
    if (operation !== 'run' || Object.keys(data).some(k => k !== 'id' && k !== 'inputs')) throw Error('FACTORY_FIELDS')
    const entry = scope?.tools.get(id)
    if (entry === undefined) throw Error('FACTORY_TOOL_NOT_FOUND')
    return { ...executeNumericRecipe(entry.recipe.program, data.inputs), id, fixtureCount: entry.recipe.passed, externalValidation: false }
  }
}
