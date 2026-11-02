/** Declarative visual renderer registry; it has no tool or permission authority. */

import type { CapabilityModality, CapabilitySurface } from '@phoenix-ai/dsh-hardness'

/** Immutable presentation model generated for one visual capability surface. */
export interface VisualRenderModel {
  readonly kind: string
  readonly surfaceId: string
  readonly [key: string]: unknown
}

/** Pure renderer that projects one governed capability surface into presentation data. */
export type VisualRenderer = (surface: CapabilitySurface) => VisualRenderModel

/** MIME/modality-neutral registry for declarative visual capability renderers. */
export class VisualToolRuntime {
  private readonly renderers = new Map<CapabilityModality, VisualRenderer>()

  /**
   * Register one renderer for a capability modality.
   * @param modality - Capability modality owned by the renderer.
   * @param renderer - Pure surface-to-render-model projection.
   * @returns Disposer that retracts this renderer when still current.
   */
  register(modality: CapabilityModality, renderer: VisualRenderer): () => void {
    this.renderers.set(modality, renderer)
    return () => {
      if (this.renderers.get(modality) === renderer) this.renderers.delete(modality)
    }
  }

  /**
   * Render a capability surface using its registered modality renderer.
   * @param surface - Governed capability surface to project.
   * @returns Frozen render model, or undefined when no renderer owns the modality.
   */
  render(surface: CapabilitySurface): VisualRenderModel | undefined {
    const renderer = this.renderers.get(surface.modality)
    if (renderer === undefined) return undefined
    return Object.freeze(renderer(surface))
  }
}
