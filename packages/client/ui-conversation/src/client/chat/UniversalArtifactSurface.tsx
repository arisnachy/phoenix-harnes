import { useRef, useState } from 'react'
import type { ImageAttachmentRef } from '@phoenix-ai/dsh-attachment'
import { Button } from '@phoenix-ai/dsh-client-ui-primitives'
import type { UniversalArtifactEnvelope } from '../conversation-nodes/hardness-artifact.ts'
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

/** Render any supported artifact in one adaptive, execution-aware surface. */
export function UniversalArtifactSurface({ artifact, renderMessageImages, loadImage, onRun, onStop }: UniversalArtifactSurfaceProps) {
  const [expanded, setExpanded] = useState(false)
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const controllerRef = useRef<AbortController | undefined>(undefined)
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
  const clipboard = Reflect.get(navigator, 'clipboard') as { writeText?: (value: string) => Promise<void> } | undefined
  const canCopy = typeof clipboard?.writeText === 'function'
  const copy = (): void => {
    if (!canCopy || typeof clipboard.writeText !== 'function') return
    void clipboard.writeText(serialized).then(() => { setCopied(true) }).catch(() => { setCopied(false) })
  }
  const attachment = imageAttachment(typeof artifact.data === 'string' ? undefined : artifact.data.attachment)
  const download = async (): Promise<void> => {
    const resolvedUrl = attachment === undefined || loadImage === undefined
      ? undefined
      : await loadImage(attachment)
    if (attachment !== undefined && resolvedUrl === undefined) return
    const url = resolvedUrl ?? URL.createObjectURL(new Blob([serialized], { type: artifact.mime }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = artifact.title.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'phoenix-artifact'
    anchor.click()
    if (resolvedUrl === undefined) URL.revokeObjectURL(url)
  }
  return (
    <section
      className={css.root}
      data-universal-artifact={artifact.id}
      data-artifact-kind={artifact.kind}
      data-artifact-height={expanded ? 'expanded' : 'auto'}
      style={{ minHeight: artifact.size.minHeight }}
    >
      <div className={css.header}>
        <div className={css.heading}>
          <strong>{artifact.title}</strong>
          <span>{artifact.language ?? artifact.kind}</span>
        </div>
        <div className={css.controls}>
          <Button variant="outline" onClick={copy} disabled={!canCopy}>{copied ? 'Copied' : 'Copy'}</Button>
          <Button variant="outline" onClick={() => { void download() }}>Download</Button>
          {artifact.executable && onRun !== undefined && <Button variant="outline" onClick={execute} disabled={running}>{running ? 'Running…' : 'Run'}</Button>}
          {artifact.executable && onRun !== undefined && <Button variant="outline" onClick={stop} disabled={!running}>Stop</Button>}
          <Button
            variant="outline"
            aria-label={expanded ? 'Collapse' : 'Expand'}
            aria-expanded={expanded}
            onClick={() => { setExpanded(value => !value) }}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </Button>
        </div>
      </div>
      <div className={css.content}>
        <HardnessArtifactBody
          mime={artifact.mime}
          data={artifact.data}
          expanded={expanded}
          title={artifact.title}
          executable={artifact.executable}
          {...renderMessageImages === undefined ? {} : { renderMessageImages }}
        />
        {artifact.result !== undefined && (
          <pre className={css.result}>{JSON.stringify(artifact.result, null, 2)}</pre>
        )}
      </div>
    </section>
  )
}
