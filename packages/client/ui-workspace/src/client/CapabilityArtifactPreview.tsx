import { createElement, type ReactNode } from 'react'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { CapabilityArtifact, CapabilityArtifactRenderModel } from './contract/slots.ts'
import { validateUiSchema, type UiNode } from './generative-ui.ts'
import { renderArtifactBlock, validateUniversalArtifact } from './universal-artifacts.ts'

export interface CapabilityArtifactPreviewProps {
  readonly artifact: CapabilityArtifact
  readonly rendered: CapabilityArtifactRenderModel
}

/** Render declarative artifacts only; it deliberately exposes no execution controls. */
export function CapabilityArtifactPreview({ artifact, rendered }: CapabilityArtifactPreviewProps): ReactNode {
  const universal = validateUniversalArtifact(artifact.data) ? artifact.data : undefined
  const ui = universal === undefined
    ? artifact.mime === 'application/vnd.hardness.ui+json' && validateUiSchema(artifact.data)
      ? renderNode(artifact.data.root)
      : createElement('pre', { style: { margin: 0, whiteSpace: 'pre-wrap', font: '500 14px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace' } }, typeof artifact.data === 'string' ? artifact.data : JSON.stringify(artifact.data, null, 2))
    : universal.blocks.map((block, index) => createElement('div', { key: `${block.type}-${index}`, style: { marginTop: index === 0 ? 0 : 16 } }, renderArtifactBlock(block)))
  const title = universal?.title ?? 'HARDNESS · Resultado'
  const status = universal?.status.toUpperCase() ?? 'VERIFICADO'
  return createElement('article', {
    'data-artifact-id': artifact.id,
    'data-artifact-mime': artifact.mime,
    style: {
      alignSelf: 'stretch', width: 'calc(100% - 32px)', maxWidth: 720,
      maxHeight: 'min(60vh, 560px)', overflow: 'auto', margin: '20px auto',
      border: '1px solid #e2e8f0', borderRadius: 20,
      background: '#ffffff', color: '#172033', boxShadow: '0 14px 36px rgba(15, 23, 42, 0.14)',
    },
  },
  createElement('header', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid #edf0f4' } },
    createElement('span', { 'aria-hidden': true, style: { display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 12, background: '#eef4ff', color: '#356ae6', fontSize: 20 } }, '✦'),
    createElement('div', { style: { display: 'grid', gap: 2, flex: 1 } },
      createElement('strong', { style: { fontSize: 16 } }, title),
      createElement('span', { style: { color: '#64748b', fontSize: 12 } }, artifact.id),
    ),
    createElement('span', { 'data-render-kind': rendered.kind, style: { padding: '6px 10px', borderRadius: 999, background: '#eef7f1', color: '#18794e', fontSize: 12, fontWeight: 700 } }, status),
  ),
  createElement('div', { style: { padding: '14px 20px 20px' } },
    createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, color: '#64748b', fontSize: 12 } },
      createElement('span', { style: { padding: '4px 8px', borderRadius: 6, background: '#f1f5f9', color: '#475569', fontWeight: 700 } }, artifact.mime),
      createElement('span', null, 'artefacto declarativo'),
    ),
    ui,
  ),
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
