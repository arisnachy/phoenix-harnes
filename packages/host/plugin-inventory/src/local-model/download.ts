import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, open, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

/** Runtime/installation failure with a stable machine-readable code. */
export class LocalModelRuntimeFault extends Error {
  /** Stable error code consumed by UI and tests. */
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LocalModelRuntimeFault'
  }
}

/** Progress emitted while one managed artifact is downloading. */
export interface ArtifactDownloadProgress {
  /** Bytes already written to the partial file. */
  receivedBytes: number
  /** Total bytes when the server discloses them. */
  totalBytes?: number
}

/** Input required to download and cryptographically activate one artifact. */
export interface ArtifactDownloadRequest {
  /** Trusted source URL from the pinned catalog. */
  sourceUrl: string
  /** Final Phoenix-managed destination path. */
  destinationPath: string
  /** Expected lowercase hexadecimal SHA-256. */
  expectedSha256: string
  /** Expected exact size when pinned by the catalog. */
  expectedSizeBytes?: number
  /** Injectable fetch implementation used by deterministic tests. */
  fetchImpl?: typeof fetch
  /** Optional progress observer. */
  onProgress?: (progress: ArtifactDownloadProgress) => void
}

/** Verified artifact activation result. */
export interface ArtifactDownloadResult {
  /** Final activated path. */
  path: string
  /** Verified file size. */
  bytes: number
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function verifiedExisting(
  filePath: string,
  expectedSha256: string,
  expectedSizeBytes?: number,
): Promise<ArtifactDownloadResult | undefined> {
  if (!await exists(filePath)) return undefined
  const metadata = await stat(filePath)
  if (expectedSizeBytes !== undefined && metadata.size !== expectedSizeBytes) return undefined
  if (await sha256File(filePath) !== expectedSha256.toLowerCase()) return undefined
  return { path: filePath, bytes: metadata.size }
}

function responseTotal(response: Response, resumedAt: number): number | undefined {
  const range = response.headers.get('content-range')
  if (range !== null) {
    const match = /\/(\d+)$/.exec(range)
    if (match?.[1] !== undefined) return Number.parseInt(match[1], 10)
  }
  const length = response.headers.get('content-length')
  if (length === null) return undefined
  const parsed = Number.parseInt(length, 10)
  return Number.isFinite(parsed) ? resumedAt + parsed : undefined
}

/**
 * Download one Phoenix-managed artifact through a resumable partial file,
 * verify exact size/SHA-256, then atomically activate it.
 * @param request - pinned source, destination, integrity facts, and optional test seams.
 * @returns the activated artifact path and verified byte size.
 */
export async function downloadVerifiedArtifact(request: ArtifactDownloadRequest): Promise<ArtifactDownloadResult> {
  const current = await verifiedExisting(
    request.destinationPath,
    request.expectedSha256,
    request.expectedSizeBytes,
  )
  if (current !== undefined) return current

  await mkdir(path.dirname(request.destinationPath), { recursive: true })
  await rm(request.destinationPath, { force: true })
  const partialPath = `${request.destinationPath}.part`
  let resumedAt = 0
  try {
    resumedAt = (await stat(partialPath)).size
  } catch {
    resumedAt = 0
  }

  const fetchImpl = request.fetchImpl ?? fetch
  const headers = resumedAt > 0 ? { Range: `bytes=${String(resumedAt)}-` } : undefined
  let response: Response
  try {
    response = await fetchImpl(request.sourceUrl, headers === undefined ? {} : { headers })
  } catch (error) {
    throw new LocalModelRuntimeFault('download-failed', `No se pudo descargar ${request.sourceUrl}.`, { cause: error })
  }
  if (!response.ok) {
    throw new LocalModelRuntimeFault('download-failed', `La descarga respondió HTTP ${String(response.status)}.`)
  }
  if (response.body === null) {
    throw new LocalModelRuntimeFault('download-failed', 'La descarga no devolvió contenido.')
  }

  const canResume = resumedAt > 0 && response.status === 206
  if (!canResume && resumedAt > 0) {
    await rm(partialPath, { force: true })
    resumedAt = 0
  }

  const file = await open(partialPath, canResume ? 'a' : 'w')
  let receivedBytes = resumedAt
  const totalBytes = responseTotal(response, resumedAt)
  request.onProgress?.({ receivedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) })
  try {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.length === 0) continue
      await file.write(value)
      receivedBytes += value.length
      request.onProgress?.({ receivedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) })
    }
  } finally {
    await file.close()
  }

  const metadata = await stat(partialPath)
  if (request.expectedSizeBytes !== undefined && metadata.size !== request.expectedSizeBytes) {
    await rm(partialPath, { force: true })
    throw new LocalModelRuntimeFault(
      'size-mismatch',
      `El archivo descargado tiene ${String(metadata.size)} bytes; se esperaban ${String(request.expectedSizeBytes)}.`,
    )
  }
  const digest = await sha256File(partialPath)
  if (digest !== request.expectedSha256.toLowerCase()) {
    await rm(partialPath, { force: true })
    throw new LocalModelRuntimeFault('hash-mismatch', 'La descarga local no superó la verificación SHA-256.')
  }

  await rm(request.destinationPath, { force: true })
  await rename(partialPath, request.destinationPath)
  return { path: request.destinationPath, bytes: metadata.size }
}
