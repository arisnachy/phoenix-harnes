/** Declarative visual renderer registry; it has no tool or permission authority. */

import type { CapabilityModality, CapabilitySurface } from '@deepseek-ai/dsh-hardness'

export interface VisualRenderModel {
  readonly kind: string
  readonly surfaceId: string
  readonly [key: string]: unknown
}

export type VisualRenderer = (surface: CapabilitySurface) => VisualRenderModel

export class VisualToolRuntime {
  private readonly renderers = new Map<CapabilityModality, VisualRenderer>()

  register(modality: CapabilityModality, renderer: VisualRenderer): () => void {
    this.renderers.set(modality, renderer)
    return () => {
      if (this.renderers.get(modality) === renderer) this.renderers.delete(modality)
    }
  }

  render(surface: CapabilitySurface): VisualRenderModel | undefined {
    const renderer = this.renderers.get(surface.modality)
    if (renderer === undefined) return undefined
    return Object.freeze(renderer(surface))
  }
}
