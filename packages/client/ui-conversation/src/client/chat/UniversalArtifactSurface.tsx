import { useEffect, useRef, useState } from 'react'
import type { ImageAttachmentRef } from '@phoenix-ai/dsh-attachment'
import type { UniversalArtifactEnvelope } from '../artifact.ts'
import { HardnessArtifactBody } from './HardnessArtifactBody.tsx'
import type { RenderMessageImages } from '../contract/slots.ts'
import css from './UniversalArtifactSurface.module.css'

/** Props for the renderer-neutral artifact surface. */
export interface UniversalArtifactSurfaceProps {
  readonly artifact: UniversalArtifactEnvelope
  readonly renderMessageImages?: RenderMessageImages
  readonly loadImage?: (attachment: ImageAttachmentRef) => Promise<string>
  readonly onRun?: (signal?: AbortSignal) => void | Promise<void>
  readonly onStop: () => void
}

function imageAttachment(value: unknown): ImageAttachmentRef | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.attachmentId !== 'string' || candidate.attachmentId.trim() === '') return undefined
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(candidate.mediaType as string)) return undefined
  if (typeof candidate.bytes !== 'number' || !Number.isInteger(candidate.bytes) || candidate.bytes <= 0) return undefined
  if (typeof candidate.width !== 'number' || !Number.isInteger(candidate.width) || candidate.width <= 0) return undefined
  if (typeof candidate.height !== 'number' || !Number.isInteger(candidate.height) || candidate.height <= 0) return undefined
  return candidate as unknown as ImageAttachmentRef
}

/** Compact, accessible icons shared by the inline and expanded artifact chrome. */
function ActionIcon({ kind }: { readonly kind: 'copy' | 'check' | 'download' | 'expand' | 'collapse' | 'run' | 'stop' }) {
  return (
    <svg className={css.actionIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {kind === 'copy' && <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>}
      {kind === 'check' && <path d="m5 12 4 4L19 6" />}
      {kind === 'download' && <><path d="M12 3v12m-5-5 5 5 5-5" /><path d="M4 17v3h16v-3" /></>}
      {kind === 'expand' && <path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" />}
      {kind === 'collapse' && <path d="M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5" />}
      {kind === 'run' && <path d="m8 5 11 7-11 7V5Z" />}
      {kind === 'stop' && <rect x="6" y="6" width="12" height="12" rx="2" />}
    </svg>
  )
}

/**
 * Render an adaptive inline artifact. Expand opens a native modal dialog in
 * the browser top layer, escaping the chat card's width and overflow clipping.
 * The chart itself is also allowed to grow in the expanded surface.
 */
export function UniversalArtifactSurface({ artifact, renderMessageImages, loadImage, onRun, onStop }: UniversalArtifactSurfaceProps) {
  const isHtml = artifact.kind === 'html'
  const [expanded, setExpanded] = useState(false)
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const controllerRef = useRef<AbortController | undefined>(undefined)

  useEffect(() => {
    if (isHtml) return
    const dialog = dialogRef.current
    if (dialog === null) return
    if (expanded && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '') // Non-browser DOMs, e.g. jsdom.
    } else if (!expanded && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [expanded, isHtml])

  const execute = (): void => {
    if (onRun === undefined || running) return
    const controller = new AbortController()
    controllerRef.current = controller
    setRunning(true)
    void Promise.resolve(onRun(controller.signal)).finally(() => {
      if (controllerRef.current === controller) controllerRef.current = undefined
      setRunning(false)
    })
  }
  const stop = (): void => {
    controllerRef.current?.abort()
    onStop()
  }
  const serialized = typeof artifact.data === 'string' ? artifact.data : JSON.stringify(artifact.data, null, 2)
  const clipboard = typeof navigator === 'undefined' ? undefined
    : Reflect.get(navigator, 'clipboard') as { writeText?: (value: string) => Promise<void> } | undefined
  const canCopy = typeof clipboard?.writeText === 'function'
  const copy = (): void => {
    if (!canCopy || typeof clipboard?.writeText !== 'function') return
    void clipboard.writeText(serialized).then(() => { setCopied(true) }).catch(() => { setCopied(false) })
  }
  const attachment = imageAttachment(typeof artifact.data === 'string' ? undefined : artifact.data.attachment)
  const download = async (): Promise<void> => {
    const resolvedUrl = attachment === undefined || loadImage === undefined
      ? undefined : await loadImage(attachment)
    if (attachment !== undefined && resolvedUrl === undefined) return
    const url = resolvedUrl ?? URL.createObjectURL(new Blob([serialized], { type: artifact.mime }))
    const anchor = document.createElement('a')
    anchor.href = url
    const basename = artifact.title.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'phoenix-artifact'
    anchor.download = artifact.mime === 'application/vnd.phoenix.scene3d+json'
      ? `${basename}.scene3d.json` : basename
    anchor.click()
    if (resolvedUrl === undefined) URL.revokeObjectURL(url)
  }
  const close = (): void => { setExpanded(false) }
  const actions = (inDialog: boolean) => (
    <div className={css.controls}>
      <button className={css.actionButton} type="button" onClick={copy} disabled={!canCopy}>
        <ActionIcon kind={copied ? 'check' : 'copy'} />{copied ? 'Copied' : 'Copy'}
      </button>
      <button className={css.actionButton} type="button" onClick={() => { void download() }}>
        <ActionIcon kind="download" />Download
      </button>
      {artifact.executable && onRun !== undefined && (
        <button className={css.actionButton} type="button" onClick={execute} disabled={running}>
          <ActionIcon kind="run" />{running ? 'Running…' : 'Run'}
        </button>
      )}
      {artifact.executable && onRun !== undefined && (
        <button className={css.actionButton} type="button" onClick={stop} disabled={!running}>
          <ActionIcon kind="stop" />Stop
        </button>
      )}
      <button className={css.actionButton} type="button"
        aria-label={inDialog ? 'Collapse' : 'Expand'} aria-expanded={inDialog}
        onClick={inDialog ? close : () => { setExpanded(true) }}>
        <ActionIcon kind={inDialog ? 'collapse' : 'expand'} />{inDialog ? 'Collapse' : 'Expand'}
      </button>
    </div>
  )
  const content = (large: boolean) => (
    <>
      <HardnessArtifactBody mime={artifact.mime} data={artifact.data}
        expanded={large} title={artifact.title} executable={artifact.executable}
        {...renderMessageImages === undefined ? {} : { renderMessageImages }} />
      {artifact.result !== undefined && (
        <pre className={css.result}>{JSON.stringify(artifact.result, null, 2)}</pre>
      )}
    </>
  )

  return (
    <section className={`${css.root} ${isHtml ? css.htmlRoot : ''}`}
      data-universal-artifact={artifact.id} data-artifact-kind={artifact.kind}
      data-artifact-height={isHtml ? 'auto' : expanded ? 'expanded' : 'auto'}
      style={isHtml ? undefined : { minHeight: artifact.size.minHeight }}>
      <div className={css.header}>
        <div className={css.heading}>
          <strong>{artifact.title}</strong>
          {!isHtml && <span>{artifact.language ?? artifact.kind}</span>}
        </div>
        {!isHtml && !expanded && actions(false)}
      </div>
      <div className={css.content}>
        {!expanded && content(false)}
      </div>
      {!isHtml && (
        <dialog ref={dialogRef} className={css.modal}
          data-phoenix-artifact-expanded="true"
          aria-label={`Vista ampliada: ${artifact.title}`} aria-modal="true"
          onClose={close} onCancel={close}
          onClick={event => { if (event.target === event.currentTarget) close() }}>
          {expanded && (
            <>
              <div className={css.modalHeader}>
                <div className={css.heading}>
                  <strong>{artifact.title}</strong>
                  <span>{artifact.language ?? artifact.kind}</span>
                </div>
                {actions(true)}
              </div>
              <div className={css.modalBody}>{content(true)}</div>
            </>
          )}
        </dialog>
      )}
    </section>
  )
}
