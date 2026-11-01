import { describe, expect, it, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { videoFrameTimes, videoMediaInput } from '../src/video-media.ts'

afterEach(() => vi.unstubAllEnvs())

describe('User-authorized media analysis', () => {
  it('chooses deterministic timestamps only within actual media duration', () => {
    expect(videoFrameTimes(12, 4)).toEqual([1.5, 4.5, 7.5, 10.5])
    expect(videoFrameTimes(0.5, 8)).toEqual([0.25])
    expect(videoFrameTimes(0, 6)).toEqual([])
    expect(videoFrameTimes(20, 9)).toEqual([])
    expect(videoFrameTimes(Infinity, 3)).toEqual([])
  })

  it('rejects arbitrary local media until a user-approved directory is configured', async () => {
    const dir=mkdtempSync(join(tmpdir(),'phoenix-media-regression-'))
    const other=mkdtempSync(join(tmpdir(),'phoenix-media-unapproved-'))
    const path=join(dir,'sample.webm')
    try {
      writeFileSync(path,Buffer.alloc(256))
      vi.stubEnv('PHOENIX_VIDEO_ALLOWED_DIRS','')
      await expect(videoMediaInput(path)).rejects.toThrow('VIDEO_ALLOWED_DIRS_NOT_CONFIGURED')
      vi.stubEnv('PHOENIX_VIDEO_ALLOWED_DIRS',other)
      await expect(videoMediaInput(path)).rejects.toThrow('VIDEO_FILE_NOT_APPROVED')
      vi.stubEnv('PHOENIX_VIDEO_ALLOWED_DIRS',dir)
      await expect(videoMediaInput(path)).resolves.toMatchObject({ source:'approved-local-file' })
      await expect(videoMediaInput(join(dir,'private.txt'))).rejects.toThrow('VIDEO_FILE_NOT_APPROVED')
    } finally {
      rmSync(dir,{ recursive:true,force:true })
      rmSync(other,{ recursive:true,force:true })
    }
  })
})
