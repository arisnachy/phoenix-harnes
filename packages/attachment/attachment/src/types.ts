/** Durable attachment vocabulary. @module @phoenix-ai/dsh-attachment/types */

import type { AttachmentId, ImageVariantId } from './brand.ts'

export type { AttachmentId } from './brand.ts'

/** Raster image formats accepted by the version-one attachment path. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** MIME value recorded for a non-image upload. The bytes remain opaque. */
export type FileMediaType = string

/** Durable, serializable reference to one immutable arbitrary file. */
export interface FileAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Caller-declared MIME value, normalized by the admitting provider. */
  mediaType: FileMediaType
  /** Exact stored byte length. */
  bytes: number
  /** Optional display name stripped of local path information. */
  name?: string
}

/** Deployment-resolved limits for arbitrary file uploads. */
export interface FileAttachmentLimits {
  maxFileBytes: number
  maxFilesPerMessage: number
  maxMessageFileBytes: number
}

/** Raw arbitrary-file input before durable publication. */
export interface SaveFileAttachment {
  data: Uint8Array
  mediaType: FileMediaType
  /** Optional browser/provider display name; never interpreted as a path. */
  name?: string
}

/** Stored arbitrary-file bytes returned after reference and digest verification. */
export interface StoredFileAttachment {
  ref: FileAttachmentRef
  data: Uint8Array
}

/** Base64-encoded arbitrary-file upload accompanying one wire request. */
export interface EncodedFileAttachment {
  mediaType: FileMediaType
  data: string
  name?: string
}

/** Durable, serializable reference to one immutable normalized image. */
export interface ImageAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Media type verified from the stored bytes. */
  mediaType: ImageMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Intrinsic encoded width in pixels. */
  width: number
  /** Intrinsic encoded height in pixels. */
  height: number
  /** Optional display name stripped of local path information. */
  name?: string
  /**
   * Input dimensions after applying EXIF orientation and before normalization
   * scaling. Present only when normalization reduced the image.
   */
  originalDimensions?: {
    width: number
    height: number
  }
}

/** Deployment-resolved limits used by upload admission and request buffering. */
export interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  /** Maximum intrinsic width and maximum intrinsic height in pixels for one image. */
  maxImageDimension: number
  mediaTypes: readonly ImageMediaType[]
}

/** Base64-encoded image upload accompanying one wire request. */
export interface EncodedImageAttachment {
  /** Declared media type, verified against the decoded bytes during admission. */
  mediaType: ImageMediaType
  /** Canonical base64 encoding of the image bytes. */
  data: string
  /** Optional display name; it is never interpreted as a path. */
  name?: string
}

/** Request to validate and durably commit one image. */
export interface SaveImageAttachment {
  data: Uint8Array
  /** Caller-declared media type, checked against fully decoded bytes. */
  mediaType: ImageMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string
}

/** Stored image bytes returned after reference and digest verification. */
export interface StoredImageAttachment {
  ref: ImageAttachmentRef
  data: Uint8Array
}

/** Deterministic request-image policy selected by one exact model route. */
export interface ImageRequestPolicy {
  /** Maximum width multiplied by height after aspect-preserving projection. */
  maxPixels: number
  /** Encoded-byte cap before base64 expansion or Files API upload. */
  maxBytes: number
}

/** Cached request version derived from one provider-independent normalized attachment. */
export interface RequestImageAttachment {
  /** Cache and upload-index key over the attachment id, policy, and fixed encoder parameters. */
  variantId: ImageVariantId
  /** Durable normalized attachment from which this request version was derived. */
  attachment: ImageAttachmentRef
  /** Encoded request bytes. */
  data: Uint8Array
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  /** Provider-compatible sample depth proven after request encoding. */
  depth: 'uchar'
  /** Provider-compatible color space proven after request encoding. */
  space: 'srgb'
  /** Whether the encoded request version retains an alpha channel. */
  hasAlpha: boolean
}
