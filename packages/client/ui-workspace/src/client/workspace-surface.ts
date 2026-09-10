import type { ILayout } from '@phoenix-ai/dsh-client-ui-layout/client'
import type { HostObservable } from '@phoenix-ai/dsh-client-ui-slots'

export const WORKSPACE_SURFACE_KINDS = ['preview', 'changes', 'files', 'browser', 'terminal'] as const
export type WorkspaceSurfaceKind = typeof WORKSPACE_SURFACE_KINDS[number]

/** One visual receipt Phoenix can expose while a mission keeps running. */
export interface WorkspaceSurfaceItem {
  readonly id: string
  readonly kind: WorkspaceSurfaceKind
  readonly title: string
  readonly content?: string
  readonly url?: string
  readonly mediaType?: string
  readonly language?: string
}

export interface WorkspaceSurfaceSnapshot {
  readonly active: WorkspaceSurfaceKind | null
  readonly items: Readonly<Record<WorkspaceSurfaceKind, WorkspaceSurfaceItem | null>>
}

export type WorkspaceSurfacePatch = Partial<Pick<WorkspaceSurfaceItem, 'title' | 'content' | 'url' | 'mediaType' | 'language'>>

/**
 * Cross-plugin face for visual work. All mutations are synchronous by design:
 * showing a preview is a side effect of the mission, never an approval gate or
 * an implicit "mission complete" boundary.
 */
export interface IWorkspaceSurface {
  readonly state: HostObservable<WorkspaceSurfaceSnapshot>
  open(item: WorkspaceSurfaceItem): void
  update(id: string, patch: WorkspaceSurfacePatch): void
  activate(kind: WorkspaceSurfaceKind): void
  collapse(): void
  clear(kind?: WorkspaceSurfaceKind): void
}

function emptyItems(): Record<WorkspaceSurfaceKind, WorkspaceSurfaceItem | null> {
  return { preview: null, changes: null, files: null, browser: null, terminal: null }
}

function validItem(item: WorkspaceSurfaceItem): void {
  if (item.id.trim() === '') throw new Error('workspace surface: item id is required')
  if (item.title.trim() === '') throw new Error('workspace surface: item title is required')
}

export class WorkspaceSurfaceController implements IWorkspaceSurface {
  #snapshot: WorkspaceSurfaceSnapshot = { active: null, items: emptyItems() }
  #listeners = new Set<() => void>()

  readonly state: HostObservable<WorkspaceSurfaceSnapshot> = {
    getSnapshot: () => this.#snapshot,
    subscribe: (listener) => {
      this.#listeners.add(listener)
      return () => { this.#listeners.delete(listener) }
    },
  }

  constructor(private readonly layout: ILayout) {}

  open(item: WorkspaceSurfaceItem): void {
    validItem(item)
    this.#snapshot = {
      active: item.kind,
      items: { ...this.#snapshot.items, [item.kind]: Object.freeze({ ...item }) },
    }
    this.#emit()
    this.layout.openWorkspaceSurface()
  }

  update(id: string, patch: WorkspaceSurfacePatch): void {
    for (const kind of WORKSPACE_SURFACE_KINDS) {
      const current = this.#snapshot.items[kind]
      if (current?.id !== id) continue
      const next = Object.freeze({ ...current, ...patch, id: current.id, kind: current.kind })
      validItem(next)
      this.#snapshot = { ...this.#snapshot, items: { ...this.#snapshot.items, [kind]: next } }
      this.#emit()
      return
    }
  }

  activate(kind: WorkspaceSurfaceKind): void {
    if (this.#snapshot.items[kind] === null) return
    if (this.#snapshot.active !== kind) {
      this.#snapshot = { ...this.#snapshot, active: kind }
      this.#emit()
    }
    this.layout.openWorkspaceSurface()
  }

  collapse(): void {
    this.layout.closeWorkspaceSurface()
  }

  clear(kind?: WorkspaceSurfaceKind): void {
    if (kind === undefined) {
      this.#snapshot = { active: null, items: emptyItems() }
      this.#emit()
      this.layout.closeWorkspaceSurface()
      return
    }
    if (this.#snapshot.items[kind] === null) return
    const items = { ...this.#snapshot.items, [kind]: null }
    let active = this.#snapshot.active
    if (active === kind) active = WORKSPACE_SURFACE_KINDS.find(candidate => items[candidate] !== null) ?? null
    this.#snapshot = { active, items }
    this.#emit()
    if (active === null) this.layout.closeWorkspaceSurface()
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) listener()
  }
}
