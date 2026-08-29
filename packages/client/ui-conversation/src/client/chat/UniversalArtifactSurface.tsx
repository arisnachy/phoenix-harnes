import { useEffect, useRef, useState } from 'react'
import { Button } from '@phoenix-ai/dsh-client-ui-primitives'
import { clampArtifactHeight, type UniversalArtifactEnvelope } from '../conversation-nodes/hardness-artifact.ts'
import { HardnessArtifactBody } from './HardnessArtifactBody.tsx'
import css from './UniversalArtifactSurface.module.css'

/** Props for the renderer-neutral artifact surface. */
export interface UniversalArtifactSurfaceProps {
  readonly artifact: UniversalArtifactEnvelope
  readonly onRun?: (signal?: AbortSignal) => void | Promise<void>
  readonly onStop: () => void
}

/** Render any supported artifact in one adaptive, execution-aware surface. */
export function UniversalArtifactSurface({ artifact, onRun, onStop }: UniversalArtifactSurfaceProps) {
  const [expanded, setExpanded] = useState(false)
  const [running, setRunning] = useState(false)
  const controllerRef = useRef<AbortController | undefined>(undefined)
  const [contentHeight, setContentHeight] = useState(artifact.size.minHeight)
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const content = contentRef.current
    if (content === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setContentHeight(clampArtifactHeight(entry.contentRect.height, artifact.size))
    })
    observer.observe(content)
    return () => { observer.disconnect() }
  }, [artifact.size])
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
  return (
    <section
      className={`${css.root} ${expanded ? css.expanded : ''}`}
      data-universal-artifact={artifact.id}
      data-artifact-kind={artifact.kind}
      data-artifact-height={expanded ? 'expanded' : String(contentHeight)}
      style={{ minHeight: artifact.size.minHeight, ...(expanded ? {} : { height: contentHeight, maxHeight: artifact.size.maxHeight }) }}
    >
      <div className={css.header}>
        <div className={css.heading}>
          <strong>{artifact.title}</strong>
          <span>{artifact.language ?? artifact.kind}</span>
        </div>
        <div className={css.controls}>
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
      <div className={css.content} ref={contentRef}>
        <HardnessArtifactBody
          mime={artifact.mime}
          data={artifact.data}
          expanded={expanded}
          title={artifact.title}
          executable={artifact.executable}
        />
        {artifact.result !== undefined && (
          <pre className={css.result}>{JSON.stringify(artifact.result, null, 2)}</pre>
        )}
      </div>
    </section>
  )
}
