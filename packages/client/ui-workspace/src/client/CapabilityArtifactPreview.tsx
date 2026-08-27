import { createElement, type ReactNode } from 'react'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { CapabilityArtifact, CapabilityArtifactRenderModel } from './contract/slots.ts'
import { validateUiSchema, type UiNode } from './generative-ui.ts'

export interface CapabilityArtifactPreviewProps {
  readonly artifact: CapabilityArtifact
  readonly rendered: CapabilityArtifactRenderModel
}

/** Render declarative artifacts only; it deliberately exposes no execution controls. */
export function CapabilityArtifactPreview({ artifact, rendered }: CapabilityArtifactPreviewProps): ReactNode {
  const ui = artifact.mime === 'application/vnd.hardness.ui+json' && validateUiSchema(artifact.data)
    ? renderNode(artifact.data.root)
    : createElement('pre', null, typeof artifact.data === 'string' ? artifact.data : JSON.stringify(artifact.data))
  return createElement('article', { 'data-artifact-id': artifact.id, 'data-artifact-mime': artifact.mime },
    createElement('strong', null, artifact.mime),
    createElement('span', { 'data-render-kind': rendered.kind }, ` ${rendered.kind}`),
    ui,
  )
}

function renderNode(node: UiNode): ReactNode {
  const label = typeof node.label === 'string' ? node.label : node.type
  if (node.type === 'stack') {
    const children = Array.isArray(node.children)
      ? node.children.filter(validateNode).map((child, index) => createElement('div', { key: `${child.type}-${index}` }, renderNode(child)))
      : []
    return createElement('section', { 'data-ui-node': 'stack' }, children)
  }
  if (node.type === 'input') return createElement('label', null, label, createElement('input', { id: typeof node.id === 'string' ? node.id : undefined, readOnly: true }))
  if (node.type === 'result') return createElement('output', { 'data-ui-node': 'result' }, label)
  if (node.type === 'button') return createElement('button', { type: 'button', disabled: true }, label)
  return createElement('div', { 'data-ui-node': node.type }, label)
}

function validateNode(value: unknown): value is UiNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as { type?: unknown }).type === 'string'
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
