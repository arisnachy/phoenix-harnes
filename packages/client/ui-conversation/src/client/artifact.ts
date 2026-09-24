import type { ImageAttachmentRef } from '@phoenix-ai/dsh-attachment'

/** Serializable payload accepted by the universal artifact surface. */
export type HardnessArtifactValue = string | Readonly<Record<string, unknown>>

/** Renderer-neutral kind selected from a MIME type and optional execution hint. */
export type ArtifactKind = 'json' | 'table' | 'visual' | 'html' | 'code' | 'markdown' | 'text' | 'image' | 'execution'

/** One artifact envelope shared by inline chat, workspace previews, and execution controls. */
export interface UniversalArtifactEnvelope {
  readonly id: string
  readonly title: string
  readonly kind: ArtifactKind
  readonly mime: string
  readonly data: HardnessArtifactValue
  readonly language?: string
  readonly executable: boolean
  readonly sourceArtifactId?: string
  readonly size: { readonly minHeight: number; readonly maxHeight: number }
  readonly result?: Readonly<Record<string, unknown>>
}

/** Select a stable renderer kind without inspecting executable content. */
function artifactKind(mime: string, data: HardnessArtifactValue): ArtifactKind {
  if (mime === 'text/html' || mime === 'application/vnd.hardness.app+html') return 'html'
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/vnd.phoenix.visual+json'
    || mime === 'application/vnd.hardness.visual+json'
    || mime === 'application/vnd.hardness.chart+json') return 'visual'
  if (mime.includes('json')) {
    if (typeof data !== 'string' && Array.isArray(data.columns) && Array.isArray(data.rows)) return 'table'
    return 'json'
  }
  if (mime.includes('markdown')) return 'markdown'
  if (mime.includes('python') || mime.includes('javascript') || mime.includes('typescript') || mime.includes('css')) return 'code'
  if (mime.startsWith('text/')) return 'text'
  return 'execution'
}

/**
 * Normalize a raw artifact into the single surface's serializable envelope.
 * @param input - Raw artifact data from a governed tool result.
 * @returns The serializable universal artifact envelope.
 */
export function normalizeHardnessArtifact(input: {
  readonly id: string
  readonly title: string
  readonly mime: string
  readonly data: HardnessArtifactValue
  readonly executable?: boolean
  readonly language?: string
  readonly sourceArtifactId?: string
  readonly result?: Readonly<Record<string, unknown>>
}): UniversalArtifactEnvelope {
  const kind = artifactKind(input.mime, input.data)
  const language = input.language
    ?? (input.mime.includes('python') ? 'python'
      : input.mime.includes('javascript') ? 'javascript'
        : input.mime.includes('typescript') ? 'typescript'
          : input.mime.includes('css') ? 'css' : undefined)
  return {
    id: input.id,
    title: input.title,
    kind,
    mime: input.mime,
    data: input.data,
    ...language === undefined ? {} : { language },
    executable: input.executable ?? (kind === 'html' || kind === 'code'),
    ...input.sourceArtifactId === undefined ? {} : { sourceArtifactId: input.sourceArtifactId },
    size: { minHeight: 160, maxHeight: 640 },
    ...input.result === undefined ? {} : { result: input.result },
  }
}

/**
 * Clamp measured content to the surface's safe responsive range.
 * @param height - Measured content height.
 * @param size - Minimum and maximum surface dimensions.
 * @returns The bounded display height.
 */
export function clampArtifactHeight(height: number, size: UniversalArtifactEnvelope['size']): number {
  return Math.round(Math.max(size.minHeight, Math.min(size.maxHeight, Number.isFinite(height) ? height : size.minHeight)))
}

/** Placeholder type import retained for generated dependency parity. */
export type ArtifactImageReference = ImageAttachmentRef
