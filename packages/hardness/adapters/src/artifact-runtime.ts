import type { ToolResult } from '@deepseek-ai/dsh-tools'

export interface CapabilityArtifact {
  readonly id: string
  readonly mime: string
  readonly data: string | Readonly<Record<string, unknown>>
}

export interface ArtifactRenderModel {
  readonly kind: string
  readonly artifactId: string
  readonly [key: string]: unknown
}

type ArtifactRenderer = (artifact: CapabilityArtifact) => ArtifactRenderModel

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function artifactFromToolResult(result: Pick<ToolResult, 'isError' | 'meta'>): CapabilityArtifact | undefined {
  if (result.isError || !isRecord(result.meta) || !isRecord(result.meta.artifact)) return undefined
  const artifact = result.meta.artifact
  if (typeof artifact.id !== 'string' || typeof artifact.mime !== 'string') return undefined
  if (typeof artifact.data !== 'string' && !isRecord(artifact.data)) return undefined
  return Object.freeze({ id: artifact.id, mime: artifact.mime, data: artifact.data })
}

export class ArtifactRuntime {
  private readonly renderers = new Map<string, ArtifactRenderer>()

  register(mime: string, renderer: ArtifactRenderer): () => void {
    this.renderers.set(mime, renderer)
    return () => {
      if (this.renderers.get(mime) === renderer) this.renderers.delete(mime)
    }
  }

  render(artifact: CapabilityArtifact): ArtifactRenderModel | undefined {
    const renderer = this.renderers.get(artifact.mime)
    return renderer === undefined ? undefined : Object.freeze(renderer(artifact))
  }
}
