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
      <div className={`${styles.body} ${expanded ? styles.bodyExpanded : ''}`}>
        <span className={styles.visuallyHidden}>{artifact.title} · {artifact.mime}</span>
        <button
          className={styles.expandButton}
          type="button"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          aria-expanded={expanded}
          onClick={() => { setExpanded(value => !value) }}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
        <HardnessArtifactBody mime={artifact.mime} data={artifact.data} expanded={expanded} title={artifact.title} />
      </div>
    </article>
  )
})
