import { memo, useState } from 'react'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { HardnessArtifactBody } from './HardnessArtifactBody.tsx'
import styles from './HardnessArtifactNodeView.module.css'

/** ChatGPT-style inline artifact card. It never owns or replaces the conversation surface. */
export const HardnessArtifactNodeView = memo(function HardnessArtifactNodeView({
  node,
}: ChatNodeViewProps<'hardness-artifact'>) {
  const [expanded, setExpanded] = useState(false)
  const artifact = node.data
  return (
    <article
      className={`${styles.card} ${expanded ? styles.expanded : ''}`}
      data-hardness-artifact={artifact.artifactId}
      data-artifact-mime={artifact.mime}
    >
      <header className={styles.header}>
        <span className={styles.icon} aria-hidden="true">✦</span>
        <span className={styles.heading}>
          <span className={styles.title}>{artifact.title}</span>
          <span className={styles.meta}>{artifact.mime}</span>
        </span>
        <button
          className={styles.expandButton}
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </header>
      <div className={`${styles.body} ${expanded ? styles.bodyExpanded : ''}`}>
        <HardnessArtifactBody mime={artifact.mime} data={artifact.data} expanded={expanded} title={artifact.title} />
      </div>
    </article>
  )
})
