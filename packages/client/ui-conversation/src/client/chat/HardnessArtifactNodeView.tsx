import { memo, useEffect, useState } from 'react'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { normalizeHardnessArtifact } from '../conversation-nodes/hardness-artifact.ts'
import { UniversalArtifactSurface } from './UniversalArtifactSurface.tsx'
import styles from './HardnessArtifactNodeView.module.css'

/** ChatGPT-style inline artifact card. It never owns or replaces the conversation surface. */
export const HardnessArtifactNodeView = memo(function HardnessArtifactNodeView({
  node, runArtifact,
}: ChatNodeViewProps<'hardness-artifact'>) {
  const artifact = node.data
  const [result, setResult] = useState<Readonly<Record<string, unknown>> | undefined>(artifact.result)
  useEffect(() => {
    if (artifact.result !== undefined) setResult(artifact.result)
  }, [artifact.result])
  const universal = normalizeHardnessArtifact({
    id: artifact.artifactId,
    title: artifact.title,
    mime: artifact.mime,
    data: artifact.data,
    executable: artifact.executable,
    ...artifact.language === undefined ? {} : { language: artifact.language },
  })
  const code = universal.kind === 'code' && typeof universal.data === 'string' ? universal.data : undefined
  return (
    <article
      className={styles.card}
      data-hardness-artifact={artifact.artifactId}
      data-artifact-mime={artifact.mime}
    >
      <div className={styles.body}>
        <span className={styles.visuallyHidden}>{artifact.mime}</span>
        <UniversalArtifactSurface
          artifact={{ ...universal, executable: artifact.executable === true, ...result === undefined ? {} : { result } }}
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
        />
      </div>
    </article>
  )
})
