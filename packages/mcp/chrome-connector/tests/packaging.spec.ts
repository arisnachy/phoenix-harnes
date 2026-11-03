/** Packaging contract for the Chrome connector executable. */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '..')

describe('@phoenix-ai/dsh-chrome-connector packaging', () => {
  it('emits the executable and shared chunk declared by package.json', () => {
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      files?: string[]
      bin?: Record<string, string>
    }
    expect(manifest.bin?.['dsh-chrome-connector']).toBe('bin/cli.mjs')
    expect(existsSync(resolve(packageRoot, 'bin/cli.mjs'))).toBe(true)
    expect(manifest.files).toContain('bin/cli.mjs')
    expect(existsSync(resolve(packageRoot, 'lib/bin.js'))).toBe(true)
    expect(manifest.files).toContain('lib/server-*.js')
  })
})
