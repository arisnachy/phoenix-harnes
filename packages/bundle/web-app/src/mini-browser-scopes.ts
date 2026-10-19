/**
 * MiniBrowser tab ownership, keyed by Phoenix conversation (session) ID.
 *
 * Multiple chats may share one Chromium process but must never share targets.
 * A Chrome tool may explicitly attach a new target to its own conversation;
 * implicit/global Chrome selection never establishes ownership.
 */
export type BrowserScopeSnapshot = Record<string, { tabIds: string[]; selectedTabId?: string }>

const VALID_ID = /^[A-Za-z0-9._:-]{1,256}$/u

/**
 * Validate a conversation or Chrome target identifier before using it as a scope key.
 * @param value - Untrusted identifier from client requests or disk.
 * @returns Whether the value is a bounded safe identifier.
 */
export function validBrowserScopeId(value: unknown): value is string {
  return typeof value === 'string' && VALID_ID.test(value)
}

/** Stateful registry that assigns every MiniBrowser tab to at most one conversation. */
export class MiniBrowserScopes {
  private readonly scopes = new Map<string, { tabIds: Set<string>; selectedTabId?: string }>()
  private readonly owners = new Map<string, string>()
  /** Monotonically increasing version for persistence after state mutations. */
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

  /**
   * Determine whether the target belongs to this conversation.
   * @param scopeId - Owning chat session.
   * @param tabId - Chrome target ID.
   * @returns True only for the current owner.
   */
  owns(scopeId: string, tabId: string): boolean {
    return this.owners.get(tabId) === scopeId
  }

  /**
   * Associate a target with its chat without changing its selected page.
   * @param scopeId - Requesting conversation.
   * @param tabId - Chrome target ID.
   * @returns Nothing; rejects cross-chat ownership conflicts.
   */
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
    if (scope.selectedTabId === undefined) this.select(scopeId, tabId)
  }

  /**
   * Remember the foreground target for one conversation.
   * @param scopeId - Requesting chat.
   * @param tabId - Already-owned target.
   * @returns Nothing; rejects foreign tabs.
   */
  select(scopeId: string, tabId: string): void {
    if (!this.owns(scopeId, tabId)) throw new Error('La pestaña no pertenece a esta conversación.')
    const scope = this.scopes.get(scopeId)
    if (scope !== undefined && scope.selectedTabId !== tabId) {
      scope.selectedTabId = tabId
      this.revision++
    }
  }

  /**
   * Forget a closed or missing target without changing another chat.
   * @param scopeId - Current owner of this tab.
   * @param tabId - Target to remove.
   * @returns Nothing; refuses foreign targets.
   */
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

  /**
   * Evict targets that are no longer present in Chromium.
   * @param scopeId - Conversation whose Chrome instance was inspected.
   * @param available - Currently active page IDs in that instance.
   * @returns Nothing; also updates the persistence revision.
   */
  prune(scopeId: string, available: readonly string[]): void {
    const live = new Set(available)
    for (const [tabId, owner] of [...this.owners]) {
      if (owner === scopeId && !live.has(tabId)) this.release(owner, tabId)
    }
  }

  /**
   * Filter an unordered Chrome target list to targets owned by one chat.
   * @param scopeId - Current conversation.
   * @param available - IDs of available browser targets.
   * @returns IDs owned by that conversation in Chrome order.
   */
  tabs(scopeId: string, available: readonly string[]): string[] {
    return available.filter(id => this.owns(scopeId, id))
  }

  /**
   * Resolve the last selected owned target and prune targets that disappeared.
   * @param scopeId - Current conversation.
   * @param available - IDs currently present in Chromium.
   * @param requestedTabId - Optional explicit tab being attached to the chat.
   * @returns Selected owned tab, or undefined if the chat has no tabs.
   */
  choose(scopeId: string, available: readonly string[], requestedTabId?: string): string | undefined {
    this.prune(scopeId, available)
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

  /**
   * Serialize only valid target ownership and selected target identifiers.
   * @returns Persistable mapping of conversation IDs to scoped targets.
   */
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
