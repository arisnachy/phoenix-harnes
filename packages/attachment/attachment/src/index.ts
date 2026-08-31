/** Durable attachment storage seam (`ctx.attachments`). @module @phoenix-ai/dsh-attachment */

import { Context, Service } from '@phoenix-ai/cordis'
import { AttachmentError } from './error.ts'
import type {
  FileAttachmentLimits,
  FileAttachmentRef,
  SaveFileAttachment,
  StoredFileAttachment,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
} from './types.ts'

export { AttachmentId, ImageVariantId } from './brand.ts'
export { AttachmentError, isImageAdmissionError } from './error.ts'
export { isFileAdmissionError } from './error.ts'
export type { AttachmentErrorCode, FileAdmissionErrorCode, ImageAdmissionErrorCode } from './error.ts'
export { admitEncodedFiles, admitEncodedImages } from './admission.ts'
export type {
  AttachmentId as AttachmentIdType,
  EncodedFileAttachment,
  FileAttachmentLimits,
  FileAttachmentRef,
  FileMediaType,
  SaveFileAttachment,
  StoredFileAttachment,
  EncodedImageAttachment,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  ImageMediaType,
  RequestImageAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
} from './types.ts'

declare module '@phoenix-ai/cordis' {
  interface Context {
    attachments: AttachmentStore
  }
}

/** Immutable binary attachment service. Implementations validate bytes before publishing a reference. */
export abstract class AttachmentStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  /** Deployment-resolved image policy used by authoritative and fast-path validation. */
  abstract readonly imageLimits: ImageAttachmentLimits

  /** Deployment-resolved limits for arbitrary file uploads. */
  readonly fileLimits: FileAttachmentLimits = Object.freeze({
    maxFileBytes: 25 * 1024 * 1024,
    maxFilesPerMessage: 20,
    maxMessageFileBytes: 100 * 1024 * 1024,
  })

  /**
   * Validate one arbitrary file without persisting it.
   * @param _input - arbitrary file bytes and declared metadata.
   * @returns completion after validation.
   */
  validateFile(_input: SaveFileAttachment): Promise<void> {
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider does not accept arbitrary files.',
      'UNSUPPORTED_FILE_TYPE',
    ))
  }

  /**
   * Validate and durably commit an ordered arbitrary-file batch.
   * @param inputs - arbitrary files in message order.
   * @returns durable references in input order.
   */
  async saveFiles(inputs: readonly SaveFileAttachment[]): Promise<readonly FileAttachmentRef[]> {
    this.validateFileBatch(inputs)
    for (const input of inputs) await this.validateFile(input)
    const refs: FileAttachmentRef[] = []
    for (const input of inputs) refs.push(await this.saveFile(input))
    return refs
  }

  /**
   * Validate and durably commit one arbitrary file.
   * @param _input - arbitrary file bytes and declared metadata.
   * @returns the durable file reference.
   */
  saveFile(_input: SaveFileAttachment): Promise<FileAttachmentRef> {
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider does not persist arbitrary files.',
      'ATTACHMENT_WRITE_FAILED',
    ))
  }

  /**
   * Read one arbitrary file and verify its durable reference.
   * @param _ref - durable file reference to read.
   * @param _signal - optional cancellation signal.
   * @returns stored bytes with verified reference metadata.
   */
  readFile(_ref: FileAttachmentRef, _signal?: AbortSignal): Promise<StoredFileAttachment> {
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider does not read arbitrary files.',
      'ATTACHMENT_READ_FAILED',
    ))
  }

  /** Validate arbitrary-file count, per-file bytes, and aggregate bytes before writes. */
  protected validateFileBatch(inputs: readonly SaveFileAttachment[]): void {
    const { maxFilesPerMessage, maxMessageFileBytes, maxFileBytes } = this.fileLimits
    if (inputs.length > maxFilesPerMessage) {
      throw new AttachmentError('File batch exceeds the configured file-count limit.', 'TOO_MANY_FILES')
    }
    const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
    if (totalBytes > maxMessageFileBytes) {
      throw new AttachmentError('File batch exceeds the configured aggregate file-byte limit.', 'FILES_TOO_LARGE')
    }
    for (const input of inputs) {
      if (input.data.byteLength > maxFileBytes) {
        throw new AttachmentError('File exceeds the configured byte limit.', 'FILE_TOO_LARGE')
      }
      if (input.mediaType.trim() === '') {
        throw new AttachmentError('File MIME type is empty.', 'UNSUPPORTED_FILE_TYPE')
      }
    }
  }

  /**
   * Validate one image without persisting it.
   * Batch callers validate every member before saving any member.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns completion after the encoded raster has been fully decoded.
   */
  abstract validateImage(input: SaveImageAttachment): Promise<void>

  /**
   * Validate one ordered image batch before committing any member.
   * Validation failures start no writes; storage failures return no partial
   * references, although already published content-addressed objects may stay
   * unreachable until a future retention policy collects them.
   * @param inputs - encoded images in their owning message order.
   * @returns durable references in the exact input order.
   */
  protected validateImageBatch(inputs: readonly SaveImageAttachment[]): void {
    const { maxImagesPerMessage, maxMessageImageBytes, mediaTypes } = this.imageLimits
    if (inputs.length > maxImagesPerMessage) {
      throw new AttachmentError('Image batch exceeds the configured image-count limit.', 'TOO_MANY_IMAGES')
    }
    const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
    if (totalBytes > maxMessageImageBytes) {
      throw new AttachmentError('Image batch exceeds the configured aggregate image-byte limit.', 'IMAGES_TOO_LARGE')
    }
    for (const input of inputs) {
      if (!mediaTypes.includes(input.mediaType)) {
        throw new AttachmentError(`Image type ${input.mediaType} is not accepted by this deployment.`, 'UNSUPPORTED_IMAGE_TYPE')
      }
    }
  }

  /**
   * Validate and durably commit one ordered image batch.
   * @param inputs - encoded images in owning-message order.
   * @returns durable normalized attachment references in the same order after every member succeeds.
   */
  async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    this.validateImageBatch(inputs)
    for (const input of inputs) await this.validateImage(input)

    const refs: ImageAttachmentRef[] = []
    for (const input of inputs) refs.push(await this.saveImage(input))
    return refs
  }

  /**
   * Validate and durably commit one image before its owning session event is appended.
   * The returned reference describes the persisted normalized image. When
   * normalization reduces the raster, its `originalDimensions` records the
   * orientation-applied input dimensions.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns the durable content-addressed normalized image reference.
   */
  abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>

  /**
   * Read one image and verify that bytes still match the recorded reference.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation for backend read and verification work.
   * @returns the verified bytes and normalized attachment reference.
   * @throws the signal reason when aborted, or a storage error when verification fails.
   */
  abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>

  /**
   * Generate or read one deterministic model-request version from the stored normalized image.
   * @param ref - durable provider-independent normalized attachment reference.
   * @param policy - exact route pixel and encoded-byte budget.
   * @param signal - optional cancellation.
   * @returns request bytes and the cache/upload identity covering every transform input.
   */
  readImageRequest(
    ref: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment> {
    signal?.throwIfAborted()
    void ref
    void policy
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider cannot derive model-request images.',
      'ATTACHMENT_PROJECTION_UNSUPPORTED',
    ))
  }

}

export default AttachmentStore
