/** Wire-form admission of base64-encoded image uploads. @module @phoenix-ai/dsh-attachment/admission */

import { Buffer } from 'node:buffer'
import { AttachmentError } from './error.ts'
import type { AttachmentStore } from './index.ts'
import type {
  EncodedFileAttachment, EncodedImageAttachment, FileAttachmentRef, ImageAttachmentRef, SaveFileAttachment,
  SaveImageAttachment,
} from './types.ts'

/** Decode one upload payload while rejecting non-canonical base64 forms. */
function decodeBase64(data: string): Uint8Array {
  const decoded = Buffer.from(data, 'base64')
  if (data.length === 0 || decoded.toString('base64') !== data) {
    throw new AttachmentError('Image upload is not canonical base64.', 'INVALID_IMAGE_BASE64')
  }
  return new Uint8Array(decoded)
}

/** Decode one arbitrary-file upload while rejecting non-canonical base64 forms. */
function decodeFileBase64(data: string): Uint8Array {
  const decoded = Buffer.from(data, 'base64')
  if (data.length === 0 || decoded.toString('base64') !== data) {
    throw new AttachmentError('File upload is not canonical base64.', 'INVALID_FILE_BASE64')
  }
  return new Uint8Array(decoded)
}

/** Store input for one decoded upload. */
function saveInput(image: EncodedImageAttachment): SaveImageAttachment {
  return {
    data: decodeBase64(image.data),
    mediaType: image.mediaType,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

/** Decode one arbitrary-file wire value into the storage seam's input type. */
function saveFileInput(file: EncodedFileAttachment): SaveFileAttachment {
  return {
    data: decodeFileBase64(file.data),
    mediaType: file.mediaType,
    ...file.name === undefined ? {} : { name: file.name },
  }
}

/**
 * Admit one wire image batch: enforce canonical base64 on every member, then
 * delegate batch admission — count and aggregate-byte limits, media-type and
 * per-image validation, ordered commit — to {@link AttachmentStore.saveImages}.
 * The shared entry for every RPC endpoint accepting browser uploads.
 * @param attachments - the deployment attachment store owning batch policy.
 * @param images - base64-encoded uploads in caller order.
 * @returns durable references in the same order as `images`.
 * @throws AttachmentError on a non-canonical payload or a refused batch.
 */
export async function admitEncodedImages(
  attachments: AttachmentStore,
  images: readonly EncodedImageAttachment[],
): Promise<readonly ImageAttachmentRef[]> {
  return attachments.saveImages(images.map(saveInput))
}

/**
 * Admit one wire arbitrary-file batch through the authoritative file store.
 * @param attachments - attachment service used to validate and persist files.
 * @param files - encoded files to admit in input order.
 * @returns durable references in the same order as the input files.
 */
export async function admitEncodedFiles(
  attachments: AttachmentStore,
  files: readonly EncodedFileAttachment[],
): Promise<readonly FileAttachmentRef[]> {
  return attachments.saveFiles(files.map(saveFileInput))
}
