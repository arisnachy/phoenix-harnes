import { describe, expect, it, vi } from 'vitest'
import { COMMONS_IMAGE_SEARCH_TIMEOUT_MS, createWebImageSearchTool, projectCommonsImages, searchCommonsImages } from '../src/image-search.ts'

const fixture = {
  query: { pages: [
    {
      title: 'File:Human heart diagram.png', index: 1,
      imageinfo: [{
        mime: 'image/png',
        thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Heart.png/640px-Heart.png',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Human_heart_diagram.png',
        extmetadata: {
          Artist: { value: '<a href="/wiki/User:X">Anatomy Artist</a>' },
          LicenseShortName: { value: 'CC BY-SA 4.0' },
          LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
        },
      }],
    },
    {
      title: 'File:Potential internal resource.png', index: 2,
      imageinfo: [{
        mime: 'image/png', thumburl: 'http://127.0.0.1/admin',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Potential_internal_resource.png',
        extmetadata: { LicenseShortName: { value: 'CC0' } },
      }],
    },
    {
      title: 'File:Unlicensed file.png', index: 3,
      imageinfo: [{
        mime: 'image/png', thumburl: 'https://upload.wikimedia.org/unlicensed.png',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Unlicensed_file.png',
      }],
    },
  ] },
}

describe('fast keyless reference image discovery', () => {
  it('retains real thumbnail, file provenance, author and license, never untrusted URLs', () => {
    expect(projectCommonsImages(fixture, 4)).toEqual([{
      src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Heart.png/640px-Heart.png',
      alt: 'Human heart diagram',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Human_heart_diagram.png',
      credit: 'Anatomy Artist',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    }])
    expect(projectCommonsImages(null)).toEqual([])
  })

  it('uses a fixed upstream host, bounds result size and passes an abort signal', async () => {
    const request = vi.fn(async (url: string | URL, options?: RequestInit) => {
      const parsed = new URL(String(url))
      expect(parsed.host).toBe('commons.wikimedia.org')
      expect(parsed.searchParams.get('generator')).toBe('search')
      expect(parsed.searchParams.get('gsrnamespace')).toBe('6')
      expect(parsed.searchParams.get('gsrsearch')).toBe('human heart')
      expect(parsed.searchParams.get('iiurlwidth')).toBe('640')
      expect(options?.signal).toBeInstanceOf(AbortSignal)
      expect(options?.redirect).toBe('error')
      return new Response(JSON.stringify(fixture), { status: 200 })
    }) as unknown as typeof fetch
    expect((await searchCommonsImages('human heart', 2, request))).toHaveLength(1)
    expect(request).toHaveBeenCalledTimes(1)
    expect(COMMONS_IMAGE_SEARCH_TIMEOUT_MS).toBe(8_000)
  })

  it('rejects invalid queries, non-raster sources, missing license and network errors', async () => {
    await expect(searchCommonsImages('x')).rejects.toThrow()
    await expect(searchCommonsImages('human heart', 7)).rejects.toThrow()
    expect(projectCommonsImages({ query: { pages: [
      { title: 'File:Example.svg', imageinfo: [{
        mime: 'image/svg+xml',
        thumburl: 'https://upload.wikimedia.org/thumb.png',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Example.svg',
        extmetadata: { LicenseShortName: { value: 'CC0' } },
      }] },
    ] } })).toEqual([])
    const offline = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    await expect(searchCommonsImages('human heart', 4, offline)).rejects.toThrow('offline')
  })

  it('registers a dedicated image search tool with a 10-second outer budget', () => {
    const tool = createWebImageSearchTool()
    expect(tool.name).toBe('web_image_search')
    expect(tool.timeoutMs).toBe(10_000)
    expect(tool.description).toContain('reference_image')
  })
})
