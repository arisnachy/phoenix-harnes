import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mountGodotWebRoute, publishGodotWebExport, serveGodotWebFile } from '../src/godot-web-bundle.ts'

const temp: string[] = []
let removeRoute: (() => void) | undefined
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-godot-web-'))
  temp.push(root)
  const dir = join(root, 'web')
  mkdirSync(dir)
  writeFileSync(join(dir, 'index.html'), '<html><script src="index.js"></script><script>new Engine({})</script></html>')
  writeFileSync(join(dir, 'index.js'), 'class Engine {}')
  writeFileSync(join(dir, 'index.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))
  writeFileSync(join(dir, 'index.pck'), Buffer.from('GDPC012345'))
  return { root, dir }
}
function mount() {
  removeRoute = mountGodotWebRoute({
    register: ({ path }) => {
      expect(path).toBe('/phoenix-games/godot')
      return () => {}
    },
  })
}
afterEach(() => {
  removeRoute?.()
  removeRoute = undefined
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true })
})
describe('Godot Web project playback host', () => {
  it('will not publish if the Phoenix host web route has not been mounted', () => {
    const { root } = workspace()
    expect(() => publishGodotWebExport('web', root, 'Native Godot')).toThrow('not mounted')
  })
  it('publishes immutable matching assets and serves them with correct MIME, isolation and CORS', async () => {
    mount()
    const { root } = workspace()
    const receipt = publishGodotWebExport('web', root, 'Godot juego')
    expect(receipt).toMatchObject({
      title: 'Godot juego', engine: 'godot', structureChecked: true,
      browserPlaybackVerified: false, fileCount: 4,
    })
    const token = receipt.url.split('/')[3]
    if (!token) throw new Error('Missing scoped token')
    temp.push(join(homedir(), '.dsh', 'game-studio-web', token))
    const server = createServer((req, res) => serveGodotWebFile(req, res))
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No TCP address')
      const base = 'http://127.0.0.1:' + address.port
      const html = await fetch(base + receipt.url)
      expect(html.status).toBe(200)
      expect(html.headers.get('content-type')).toContain('text/html')
      expect(html.headers.get('content-security-policy')).toContain('wasm-unsafe-eval')
      expect(html.headers.get('content-security-policy')).toContain("object-src 'none'")
      expect(html.headers.get('access-control-allow-origin')).toBe('*')
      expect(await html.text()).toContain('new Engine')
      const wasm = await fetch(base + receipt.url.replace('.html', '.wasm'))
      expect(wasm.headers.get('content-type')).toContain('application/wasm')
      expect(new Uint8Array(await wasm.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([0, 97, 115, 109]))
      const traversal = await fetch(base + '/phoenix-games/godot/' + token + '/../manifest.json.phoenix')
      expect(traversal.status).toBe(404)
      const bad = await fetch(base + '/phoenix-games/godot/' + 'f'.repeat(48) + '/index.html')
      expect(bad.status).toBe(404)
      const post = await fetch(base + receipt.url, { method: 'POST' })
      expect(post.status).toBe(405)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
  it('rejects symlinks and forged Godot binary files', () => {
    mount()
    const { root, dir } = workspace()
    writeFileSync(join(dir, 'index.pck'), Buffer.from('FAKEPACK'))
    expect(() => publishGodotWebExport('web', root, 'Fake')).toThrow('Invalid Godot PCK')
    writeFileSync(join(dir, 'index.pck'), Buffer.from('GDPC0123'))
    rmSync(join(dir, 'index.wasm'))
    if (process.platform !== 'win32') {
      const outside = join(root, 'outside.wasm')
      writeFileSync(outside, Buffer.from([0, 97, 115, 109]))
      symlinkSync(outside, join(dir, 'index.wasm'))
      expect(() => publishGodotWebExport('web', root, 'Escape')).toThrow('escaping')
    }
    expect(() => publishGodotWebExport('../', root, 'Outside')).toThrow('inside')
  })
})
