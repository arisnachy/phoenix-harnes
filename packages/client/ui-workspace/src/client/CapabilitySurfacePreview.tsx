import type { CapabilitySurface } from '@deepseek-ai/dsh-hardness'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { createElement, type ReactNode } from 'react'

export interface CapabilitySurfacePreviewProps {
  readonly surface: CapabilitySurface
}

/** Pure preview: displays declarations only and exposes no execution action. */
export function CapabilitySurfacePreview({ surface }: CapabilitySurfacePreviewProps): ReactNode {
  return createElement('section', { 'data-capability-surface': surface.id },
    createElement('strong', null, surface.capabilityId),
    createElement('span', null, ` ${surface.modality} · ${surface.verification}`),
    createElement('ul', null, ...surface.outputs.map(output => createElement('li', { key: output }, output))),
  )
}

/** Register one declarative preview into the dedicated list slot. */
export function registerCapabilitySurfacePreview(
  slots: SlotRegistry,
  surface: CapabilitySurface,
): () => void {
  return slots.register({
    name: 'capability.surface.preview',
    id: surface.id,
    label: surface.capabilityId,
    inject: () => ({ surface }),
  } as never, CapabilitySurfacePreview as never)
}
