import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectGodotWebExport } from '../godot/web-export-preflight.mjs'

const temporary: string[] = []
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })

function candidate(): string {
  const path = mkdtempSync(join(tmpdir(), 'phoenix-web-bundle-'))
  temporary.push(path)
  writeFileSync(join(path, 'index.html'), '<html><script src="index.js"></script><script>new Engine({})</script></html>')
  writeFileSync(join(path, 'index.js'), 'class Engine {}')
  writeFileSync(join(path, 'index.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))
  writeFileSync(join(path, 'index.pck'), Buffer.from('GDPC01234'))
  return path
}

describe('Godot Web export preflight (structural, not runtime certification)', () => {
  it('accepts a coherent multi-file export without claiming it ran in a browser', () => {
    const path = candidate()
    const report = inspectGodotWebExport(path)
    expect(report).toMatchObject({
      engine: 'godot', entry: 'index.html', packageStructureVerified: true,
      browserPlaybackVerified: false, embeddedInPhoenixChat: false,
    })
    expect(report.files.map(item => item.path)).toEqual(['index.html', 'index.js', 'index.wasm', 'index.pck'])
  })
  it('rejects a Godot HTML shell without the required binaries', () => {
    const path = candidate()
    rmSync(join(path, 'index.wasm'))
    expect(() => inspectGodotWebExport(path)).toThrow('missing index.wasm')
  })
  it('rejects non-WebAssembly or fake PCK binary assets', () => {
    const path = candidate()
    writeFileSync(join(path, 'index.wasm'), Buffer.from('FAKEBLOB'))
    expect(() => inspectGodotWebExport(path)).toThrow('Invalid WebAssembly magic')
    writeFileSync(join(path, 'index.wasm'), Buffer.from([0, 97, 115, 109, 1]))
    writeFileSync(join(path, 'index.pck'), Buffer.from('NOTPCK'))
    expect(() => inspectGodotWebExport(path)).toThrow('Invalid Godot PCK header')
  })
  it('rejects escaped or invalid entry names', () => {
    const path = candidate()
    expect(() => inspectGodotWebExport(path, '../index.html')).toThrow('simple .html')
    expect(() => inspectGodotWebExport(path, 'index.js')).toThrow('simple .html')
  })
  it('rejects required files that escape the export root through symlinks', () => {
    const path = candidate()
    const foreign = join(mkdtempSync(join(tmpdir(), 'phoenix-web-outside-')), 'index.wasm')
    temporary.push(join(foreign, '..'))
    writeFileSync(foreign, Buffer.from([0, 97, 115, 109, 1]))
    rmSync(join(path, 'index.wasm'))
    symlinkSync(foreign, join(path, 'index.wasm'))
    expect(() => inspectGodotWebExport(path)).toThrow('must remain inside')
  })
})
