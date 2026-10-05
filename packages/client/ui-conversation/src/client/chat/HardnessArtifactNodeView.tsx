import { memo, useEffect, useRef, useState } from 'react'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { normalizeHardnessArtifact } from '../artifact.ts'
import { UniversalArtifactSurface } from './UniversalArtifactSurface.tsx'
import styles from './HardnessArtifactNodeView.module.css'

/** ChatGPT-style inline artifact card. It never owns or replaces the conversation surface. */
export const HardnessArtifactNodeView = memo(function HardnessArtifactNodeView({
  node, openCanvas, runArtifact, renderMessageImages, loadImage,
}: ChatNodeViewProps<'hardness-artifact'>) {
  const artifact = node.data
  const isCanvas = artifact.mime === 'application/vnd.phoenix.canvas+html' && typeof artifact.data === 'string'
  const [canvasRouted, setCanvasRouted] = useState<boolean | null>(null)
  const routedCanvasRef = useRef<string | null>(null)
  const [result, setResult] = useState<Readonly<Record<string, unknown>> | undefined>(artifact.result)
  useEffect(() => {
    if (artifact.result !== undefined) setResult(artifact.result)
  }, [artifact.result])
  useEffect(() => {
    if (!isCanvas) {
      setCanvasRouted(null)
      return
    }
    if (openCanvas === undefined) {
      setCanvasRouted(false)
      return
    }
    if (routedCanvasRef.current === artifact.artifactId) return
    const opened = openCanvas({
      title: artifact.title,
      html: artifact.data as string,
      executable: artifact.executable !== false,
    })
    setCanvasRouted(opened)
    if (opened) routedCanvasRef.current = artifact.artifactId
  }, [artifact.artifactId, artifact.data, artifact.executable, artifact.title, isCanvas, openCanvas])

  const universal = normalizeHardnessArtifact({
    id: artifact.artifactId,
    title: artifact.title,
    mime: artifact.mime,
    data: artifact.data,
    executable: artifact.executable,
    ...artifact.language === undefined ? {} : { language: artifact.language },
  })
  const code = universal.kind === 'code' && typeof universal.data === 'string' ? universal.data : undefined
  if (isCanvas && openCanvas !== undefined && canvasRouted !== false) {
    const reopen = (): void => {
      const opened = openCanvas({
        title: artifact.title,
        html: artifact.data as string,
        executable: artifact.executable !== false,
      })
      setCanvasRouted(opened)
      if (opened) routedCanvasRef.current = artifact.artifactId
    }
    return (
      <article
        className={styles.card}
        data-hardness-artifact={artifact.artifactId}
        data-artifact-mime={artifact.mime}
        data-canvas-workspace-launcher
      >
        <button type="button" className={styles.canvasLauncher} onClick={reopen}>
          <span className={styles.canvasTitle}>{artifact.title}</span>
          <span className={styles.canvasHint}>Canvas · visual workspace</span>
        </button>
      </article>
    )
  }
  return (
    <article
      className={styles.card}
      data-hardness-artifact={artifact.artifactId}
      data-artifact-mime={artifact.mime}
    >
      <div className={`${styles.body} ${universal.kind === 'html' ? styles.bodyHtml : ''}`}>
        <span className={styles.visuallyHidden}>{artifact.mime}</span>
        <UniversalArtifactSurface
          artifact={{ ...universal, executable: artifact.executable, ...result === undefined ? {} : { result } }}
          {...runArtifact !== undefined && code !== undefined
            ? { onRun: async (signal) => {
              const value = await runArtifact({
                id: universal.id, mime: universal.mime, data: code,
                callId: artifact.callId,
                ...universal.language === undefined ? {} : { language: universal.language },
              }, signal)
              setResult(typeof value === 'object' && value !== null && !Array.isArray(value)
                ? value as Readonly<Record<string, unknown>>
                : { value })
            } }
            : {}}
          onStop={() => {}}
          renderMessageImages={renderMessageImages}
          {...loadImage === undefined ? {} : { loadImage }}
        />
      </div>
    </article>
  )
})
