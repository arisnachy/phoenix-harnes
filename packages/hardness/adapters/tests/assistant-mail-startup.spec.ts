import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mailStartupSpec } from '../src/assistant-mail-startup.ts'
describe('local Windows startup', () => {
  it('passes owner-root and enable choice as literal arguments without a shell', () => {
    const root = resolve('Phoenix with spaces')
    const spec = mailStartupSpec(root, true, {})
    expect(spec.argv).toContain(join(root, 'scripts', 'phoenix-assistant-startup.ps1'))
    expect(spec.argv.slice(-2)).toEqual(['-Enabled', 'true'])
    expect(spec.cwd).toBe(root)
    expect(() => mailStartupSpec('relative-root', true, {})).toThrow('absolute')
  })
})
