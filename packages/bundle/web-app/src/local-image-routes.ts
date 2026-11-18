/** Private loopback image delivery for PHOENIX's local FastSD MCP tool.
 * Files are created with random 128-bit names under a user-scoped directory.
 * No arbitrary path, file listing, upload, CORS or LAN access is exposed.
 */
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@phoenix-ai/cordis'
import type {} from '@phoenix-ai/dsh-host-webserver'

const MAX_IMAGE_BYTES = 12_000_000
const FILE_PATTERN = /^\/local-images\/([a-f0-9]{32})\.jpg$/u

export function localImageRoot(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.LOCALAPPDATA
    ? join(env.LOCALAPPDATA, 'PHOENIX')
    : join(homedir(), '.phoenix')
  return resolve(env.PHOENIX_LOCAL_IMAGE_HOME || join(base, 'images'))
}

export function registerLocalImageRoutes(ctx: Context): void {
  if (ctx.webServer.host !== '127.0.0.1') {
    ctx.logger.warn('Local image delivery only supports the private 127.0.0.1 bind.')
    return
  }
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: '/local-images',
    handler: async (req, res) => {
      const headers = {
        'cache-control': 'private, max-age=3600',
        'cross-origin-resource-policy': 'same-origin',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      }
      const address = req.socket.remoteAddress || ''
      const host = req.headers.host || ''
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) ||
          !/^127\.0\.0\.1:\d{1,5}$/u.test(host)) {
        res.writeHead(403, headers); res.end(); return
      }
      if (req.method !== 'GET') {
        res.writeHead(405, { ...headers, allow: 'GET' }); res.end(); return
      }
      const path = new URL(req.url || '/', 'http://127.0.0.1').pathname
      const id = FILE_PATTERN.exec(path)?.[1]
      if (!id) { res.writeHead(404, headers); res.end(); return }
      try {
        const file = join(localImageRoot(), id + '.jpg')
        const details = await stat(file)
        if (!details.isFile() || details.size < 32 || details.size > MAX_IMAGE_BYTES) {
          res.writeHead(404, headers); res.end(); return
        }
        const bytes = await readFile(file)
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
            bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
          res.writeHead(404, headers); res.end(); return
        }
        res.writeHead(200, {
          ...headers,
          'content-type': 'image/jpeg',
          'content-length': String(bytes.length),
        })
        res.end(bytes)
      } catch {
        res.writeHead(404, headers); res.end()
      }
    },
  })
  ctx.effect(() => dispose, 'PHOENIX local FastSD image route')
}
