import type { ToolResult } from '@phoenix-ai/dsh-tools'

/** Serializable artifact emitted by a successful governed capability result. */
export interface CapabilityArtifact {
  readonly id: string
  readonly mime: string
  readonly data: string | Readonly<Record<string, unknown>>
}

/** Provider-neutral presentation model produced by an artifact renderer. */
export interface ArtifactRenderModel {
  readonly kind: string
  readonly artifactId: string
  readonly [key: string]: unknown
}

type ArtifactRenderer = (artifact: CapabilityArtifact) => ArtifactRenderModel

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Extract a valid artifact from one successful tool result.
 * @param result - tool result carrying optional artifact metadata.
 * @returns frozen artifact when metadata is valid, otherwise undefined.
 */
export function artifactFromToolResult(result: Pick<ToolResult, 'isError' | 'meta'>): CapabilityArtifact | undefined {
  if (result.isError || !isRecord(result.meta) || !isRecord(result.meta.artifact)) return undefined
  const artifact = result.meta.artifact
  if (typeof artifact.id !== 'string' || typeof artifact.mime !== 'string') return undefined
  if (typeof artifact.data !== 'string' && !isRecord(artifact.data)) return undefined
  return Object.freeze({ id: artifact.id, mime: artifact.mime, data: artifact.data })
}

/** MIME-keyed registry that converts capability artifacts into render models. */
export class ArtifactRuntime {
  private readonly renderers = new Map<string, ArtifactRenderer>()

  /**
   * Register one MIME renderer.
   * @param mime - exact MIME type owned by the renderer.
   * @param renderer - pure artifact-to-render-model projection.
   * @returns disposer that retracts this renderer when still current.
   */
  register(mime: string, renderer: ArtifactRenderer): () => void {
    this.renderers.set(mime, renderer)
    return () => {
      if (this.renderers.get(mime) === renderer) this.renderers.delete(mime)
    }
  }

  /**
   * Render one artifact with its registered MIME renderer.
   * @param artifact - validated capability artifact.
   * @returns frozen render model, or undefined when no renderer owns the MIME.
   */
  render(artifact: CapabilityArtifact): ArtifactRenderModel | undefined {
    const renderer = this.renderers.get(artifact.mime)
    return renderer === undefined ? undefined : Object.freeze(renderer(artifact))
  }
}
