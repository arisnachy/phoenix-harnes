// Verification-only touch: exercises the stable Cordis TypeScript/build path in CI.
import { useSyncExternalStore } from 'react'
import type { ILayout } from '@phoenix-ai/dsh-client-ui-layout/client'
import css from './CordisVisualWorkspace.module.css'

/** Media/document surfaces Cordis may present beside the conversation. */
export type CordisVisualContent =
  | { readonly kind: 'image'; readonly src: string; readonly title?: string; readonly alt?: string }
  | { readonly kind: 'video'; readonly src: string; readonly title?: string; readonly poster?: string; readonly autoplay?: boolean }
  | { readonly kind: 'page'; readonly url: string; readonly title?: string }
  | { readonly kind: 'text'; readonly text: string; readonly title?: string }

/** Public client service used by Phoenix plugins to drive the Cordis visual workspace. */
export interface ICordisVisualWorkspace {
  /** Show or replace the current visual surface. */
  show(content: CordisVisualContent): void
  /** Close the Cordis surface and restore the shell geometry borrowed by Cordis. */
  close(): void
  /** Read the current surface. */
  getSnapshot(): CordisVisualContent | null
  /** Subscribe to surface changes. */
  subscribe(listener: () => void): () => void
}

/** Event-backed controller for the Cordis visual workspace. */
export class CordisVisualWorkspaceController implements ICordisVisualWorkspace {
  #content: CordisVisualContent | null = null
  #listeners = new Set<() => void>()

  constructor(private readonly layout: ILayout) {}

  /** Show or replace the current visual surface. */
  show(content: CordisVisualContent): void {
    const wasClosed = this.#content === null
    this.#content = Object.freeze({ ...content }) as CordisVisualContent
    if (wasClosed) this.layout.setWorkspaceOccupant('cordis', true)
    this.#emit()
  }

  /** Close the surface and restore the exact pre-Cordis shell geometry. */
  close(): void {
    if (this.#content === null) return
    this.#content = null
    this.#emit()
    this.layout.setWorkspaceOccupant('cordis', false)
  }

  /** Read the stable current surface snapshot. */
  getSnapshot = (): CordisVisualContent | null => this.#content

  /** Subscribe to surface changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /** Release any active dock lease during plugin teardown. */
  dispose(): void {
    this.close()
    this.#listeners.clear()
  }

  #emit(): void {
    for (const listener of this.#listeners) listener()
  }
}

function contentTitle(content: CordisVisualContent): string {
  return content.title?.trim() || 'Cordis'
}

function safePageUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function Surface({ content }: { content: CordisVisualContent }) {
  switch (content.kind) {
    case 'image':
      return <img className={css.image} src={content.src} alt={content.alt ?? content.title ?? ''} />
    case 'video':
      return (
        <video
          className={css.video}
          src={content.src}
          poster={content.poster}
          controls
          autoPlay={content.autoplay}
          playsInline
        />
      )
    case 'page': {
      const url = safePageUrl(content.url)
      if (url === null) return <div className={css.error}>Cordis blocked an invalid page URL.</div>
      return (
        <div className={css.pageWrap}>
          <iframe
            className={css.page}
            src={url}
            title={content.title ?? 'Cordis page'}
            sandbox="allow-downloads allow-forms allow-modals allow-popups allow-scripts"
            referrerPolicy="no-referrer"
          />
          <a className={css.externalLink} href={url} target="_blank" rel="noreferrer">Open page in browser</a>
        </div>
      )
    }
    case 'text':
      return <pre className={css.text}>{content.text}</pre>
  }
}

/** Visual surface mounted in Phoenix's shared KIRA/Cordis right rail. */
export function CordisVisualWorkspace({
  controller,
  layout,
}: {
  controller: ICordisVisualWorkspace
  layout: ILayout
}) {
  const content = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const occupancy = useSyncExternalStore(
    layout.subscribeWorkspaceOccupancy,
    layout.getWorkspaceOccupancy,
    layout.getWorkspaceOccupancy,
  )

  if (content === null) return null

  return (
    <aside
      className={css.root}
      data-cordis-workspace
      data-under-subagent={occupancy.subagent || undefined}
      aria-label="Cordis visual workspace"
    >
      <header className={css.header}>
        <div className={css.title}>{contentTitle(content)}</div>
        <button type="button" className={css.close} aria-label="Close Cordis workspace" onClick={() => controller.close()}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className={css.body}><Surface content={content} /></div>
    </aside>
  )
}
