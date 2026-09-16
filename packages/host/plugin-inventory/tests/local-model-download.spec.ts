import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { downloadVerifiedArtifact, LocalModelRuntimeFault } from '../src/local-model/download.js'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('downloadVerifiedArtifact', () => {
  it('resumes a partial download and activates it atomically after SHA-256 verification', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'phoenix-local-download-'))
    const destinationPath = path.join(root, 'model.gguf')
    await writeFile(`${destinationPath}.part`, 'abc')
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('range')).toBe('bytes=3-')
      return new Response('def', {
        status: 206,
        headers: { 'content-range': 'bytes 3-5/6', 'content-length': '3' },
      })
    })

    const result = await downloadVerifiedArtifact({
      sourceUrl: 'https://example.invalid/model.gguf',
      destinationPath,
      expectedSha256: sha256('abcdef'),
      expectedSizeBytes: 6,
      fetchImpl,
    })

    expect(result).toEqual({ path: destinationPath, bytes: 6 })
    await expect(readFile(destinationPath, 'utf8')).resolves.toBe('abcdef')
    await expect(access(`${destinationPath}.part`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('restarts cleanly when a server ignores the Range header', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'phoenix-local-download-'))
    const destinationPath = path.join(root, 'runtime.zip')
    await writeFile(`${destinationPath}.part`, 'old')
    const fetchImpl = vi.fn(async () => new Response('fresh', { status: 200 }))

    await downloadVerifiedArtifact({
      sourceUrl: 'https://example.invalid/runtime.zip',
      destinationPath,
      expectedSha256: sha256('fresh'),
      expectedSizeBytes: 5,
      fetchImpl,
    })

    await expect(readFile(destinationPath, 'utf8')).resolves.toBe('fresh')
  })

  it('deletes an untrusted partial file when the checksum does not match', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'phoenix-local-download-'))
    const destinationPath = path.join(root, 'model.gguf')
    const fetchImpl = vi.fn(async () => new Response('tampered', { status: 200 }))

    const promise = downloadVerifiedArtifact({
      sourceUrl: 'https://example.invalid/model.gguf',
      destinationPath,
      expectedSha256: sha256('expected'),
      fetchImpl,
    })

    await expect(promise).rejects.toMatchObject<Partial<LocalModelRuntimeFault>>({ code: 'hash-mismatch' })
    await expect(access(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(`${destinationPath}.part`)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
