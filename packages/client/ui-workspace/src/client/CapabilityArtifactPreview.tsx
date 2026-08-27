import { createElement, type ReactNode } from 'react'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { CapabilityArtifact, CapabilityArtifactRenderModel } from './contract/slots.ts'

export interface CapabilityArtifactPreviewProps {
  readonly artifact: CapabilityArtifact
  readonly rendered: CapabilityArtifactRenderModel
}

/** Pure artifact preview; it deliberately exposes no execution controls. */
export function CapabilityArtifactPreview({ artifact, rendered }: CapabilityArtifactPreviewProps): ReactNode {
  const data = typeof artifact.data === 'string' ? artifact.data : JSON.stringify(artifact.data)
  return createElement('article', { 'data-artifact-id': artifact.id, 'data-artifact-mime': artifact.mime },
    createElement('strong', null, artifact.mime),
    createElement('span', { 'data-render-kind': rendered.kind }, ` ${rendered.kind}`),
    createElement('pre', null, data),
  )
}

/** Add one rendered artifact to the workspace-facing preview slot. */
export function registerCapabilityArtifactPreview(
  slots: SlotRegistry,
  artifact: CapabilityArtifact,
  rendered: CapabilityArtifactRenderModel,
): () => void {
  return slots.register({
    name: 'shell.overlay',
    id: artifact.id,
    label: artifact.mime,
    inject: () => ({ artifact, rendered }),
  } as never, CapabilityArtifactPreview as never)
}
