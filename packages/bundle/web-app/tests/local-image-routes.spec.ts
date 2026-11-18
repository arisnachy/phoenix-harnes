import { describe, expect, it } from 'vitest'
import { resolve, join } from 'node:path'
import { localImageRoot } from '../src/local-image-routes.ts'

describe('local image files', () => {
  it('stores generated images in an isolated user-scoped folder', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' }
    expect(localImageRoot(env)).toBe(resolve(join(env.LOCALAPPDATA, 'PHOENIX', 'images')))
  })
  it('allows a named, explicit PHOENIX_LOCAL_IMAGE_HOME override', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\tester', PHOENIX_LOCAL_IMAGE_HOME: '/tmp/test-local-images' }
    expect(localImageRoot(env)).toBe(resolve('/tmp/test-local-images'))
  })
})
