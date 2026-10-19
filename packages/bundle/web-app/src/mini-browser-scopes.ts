/**
 * MiniBrowser tab ownership, keyed by Phoenix conversation (session) ID.
 *
 * Multiple chats may share one Chromium process but must never share targets.
 * A Chrome tool may explicitly attach a new target to its own conversation;
 * implicit/global Chrome selection never establishes ownership.
 */
export type BrowserScopeSnapshot = Record<string, { tabIds: string[]; selectedTabId?: string }>

const VALID_ID = /^[A-Za-z0-9._:-]{1,256}$/u

export function validBrowserScopeId(value: unknown): value is string {
  return typeof value === 'string' && VALID_ID.test(value)
}

export class MiniBrowserScopes {
  private readonly scopes = new Map<string, { tabIds: Set<string>; selectedTabId?: string }>()
  private readonly owners = new Map<string, string>()
  revision = 0

  constructor(saved?: unknown) {
    if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) return
    for (const [scopeId, raw] of Object.entries(saved)) {
      if (!validBrowserScopeId(scopeId) || raw === null || typeof raw !== 'object') continue
      const data = raw as { tabIds?: unknown; selectedTabId?: unknown }
      if (!Array.isArray(data.tabIds)) continue
      for (const tabId of data.tabIds.slice(0, 256)) {
        if (validBrowserScopeId(tabId) && !this.owners.has(tabId)) this.claim(scopeId, tabId)
      }
      if (validBrowserScopeId(data.selectedTabId) && this.owns(scopeId, data.selectedTabId)) {
        this.select(scopeId, data.selectedTabId)
      }
    }
    this.revision = 0
  }

  owns(scopeId: string, tabId: string): boolean {
    return this.owners.get(tabId) === scopeId
  }

  claim(scopeId: string, tabId: string): void {
    if (!validBrowserScopeId(scopeId) || !validBrowserScopeId(tabId)) throw new Error('Identificador de conversación o pestaña inválido.')
    const existing = this.owners.get(tabId)
    if (existing !== undefined && existing !== scopeId) {
      throw new Error('Esta pestaña pertenece a otra conversación de Phoenix.')
    }
    let scope = this.scopes.get(scopeId)
    if (scope === undefined) {
      scope = { tabIds: new Set() }
      this.scopes.set(scopeId, scope)
    }
    if (!scope.tabIds.has(tabId)) {
      scope.tabIds.add(tabId)
      this.owners.set(tabId, scopeId)
      this.revision++
    }
    this.select(scopeId, tabId)
  }

  select(scopeId: string, tabId: string): void {
    if (!this.owns(scopeId, tabId)) throw new Error('La pestaña no pertenece a esta conversación.')
    const scope = this.scopes.get(scopeId)
    if (scope !== undefined && scope.selectedTabId !== tabId) {
      scope.selectedTabId = tabId
      this.revision++
    }
  }

  release(scopeId: string, tabId: string): void {
    if (!this.owns(scopeId, tabId)) throw new Error('La pestaña no pertenece a esta conversación.')
    const scope = this.scopes.get(scopeId)
    scope?.tabIds.delete(tabId)
    this.owners.delete(tabId)
    if (scope?.selectedTabId === tabId) {
      const next = scope.tabIds.values().next().value
      if (next === undefined) delete scope.selectedTabId
      else scope.selectedTabId = next
    }
    if (scope?.tabIds.size === 0) this.scopes.delete(scopeId)
    this.revision++
  }

  prune(available: readonly string[]): void {
    const live = new Set(available)
    for (const [tabId, owner] of [...this.owners]) {
      if (!live.has(tabId)) this.release(owner, tabId)
    }
  }

  tabs(scopeId: string, available: readonly string[]): string[] {
    return available.filter(id => this.owns(scopeId, id))
  }

  choose(scopeId: string, available: readonly string[], requestedTabId?: string): string | undefined {
    this.prune(available)
    if (requestedTabId !== undefined) {
      if (!available.includes(requestedTabId)) throw new Error('No hay una pestaña Chromium disponible.')
      this.claim(scopeId, requestedTabId)
    }
    const own = this.tabs(scopeId, available)
    const scope = this.scopes.get(scopeId)
    const chosen = own.includes(scope?.selectedTabId ?? '') ? scope?.selectedTabId : own[0]
    if (chosen !== undefined) this.select(scopeId, chosen)
    return chosen
  }

  snapshot(): BrowserScopeSnapshot {
    const saved: BrowserScopeSnapshot = {}
    for (const [id, scope] of this.scopes) {
      saved[id] = {
        tabIds: [...scope.tabIds],
        ...(scope.selectedTabId === undefined ? {} : { selectedTabId: scope.selectedTabId }),
      }
    }
    return saved
  }
}
