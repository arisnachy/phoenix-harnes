import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@phoenix-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

const WINDOWS = process.platform === 'win32'

interface CapturedResponse {
  code: number
  body: string
}

const TEST_DPAPI_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Security',
  '$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json',
  '$body = [Convert]::FromBase64String($payload.body)',
  '$entropy = [Convert]::FromBase64String($payload.entropy)',
  '$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser',
  '$result = [System.Security.Cryptography.ProtectedData]::Protect($body, $entropy, $scope)',
  '[Console]::Out.Write([Convert]::ToBase64String($result))',
].join('\n')

/** Protect a deliberately malformed fixture with the production entropy scheme. */
async function protectFixture(origin: string, payload: Record<string, unknown>): Promise<string> {
  const child = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(TEST_DPAPI_SCRIPT, 'utf16le').toString('base64'),
  ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
  return await new Promise<string>((resolve, reject) => {
    let output = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(output.trim())
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('test DPAPI helper timeout'))
    }, 12_000)
    child.on('error', () =>{  finish(new Error('test DPAPI helper unavailable')) })
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    child.on('close', (code) => {
      if (code !== 0 || !output.trim()) finish(new Error('test DPAPI helper rejected fixture'))
      else finish()
    })
    child.stdin.end(JSON.stringify({
      body: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
      entropy: createHash('sha256').update(`phoenix-login-v1:${origin}`).digest('base64'),
    }))
  })
}

async function writeDpapiFixture(home: string, origin: string, payload: Record<string, unknown>): Promise<void> {
  const directory = join(home, 'secure-logins')
  await mkdir(directory, { recursive: true })
  const sealed = await protectFixture(origin, payload)
  const path = join(directory, createHash('sha256').update(origin).digest('hex') + '.dpapi.json')
  await writeFile(path, JSON.stringify({ version: 1, origin, automatic: true, sealed }), { encoding: 'utf8' })
}

/** Invoke the protected loopback route without putting credentials in a model-facing surface. */
async function invokeRoute(
  handler: (request: unknown, response: unknown) => Promise<void>,
  method: 'GET' | 'POST',
  url: string,
  host: string,
  body?: Record<string, unknown>,
): Promise<CapturedResponse> {
  const request = Object.assign(
    Readable.from(body === undefined ? [] : [JSON.stringify(body)]),
    {
      method,
      url,
      socket: { remoteAddress: '127.0.0.1' },
      headers: {
        host,
        origin: `http://${host}`,
        'x-phoenix-secure-login': '1',
      },
    },
  )
  let code = 0
  let responseBody = ''
  const response = {
    writeHead(status: number) { code = status },
    end(value?: string) { responseBody = value ?? '' },
  }
  await handler(request, response)
  return { code, body: responseBody }
}

describe.skipIf(!WINDOWS)('Windows DPAPI secure-login integration', () => {
  it('saves, reads back, resolves, and uses fictitious access in an isolated DSH_HOME', async () => {
    const previousHome = process.env.DSH_HOME
    const isolatedHome = await mkdtemp(join(tmpdir(), 'phoenix-secret-vault-'))
    process.env.DSH_HOME = isolatedHome
    vi.resetModules()

    const origin = 'https://vault-integration.invalid'
    const account = 'synthetic-integration-account'
    const secret = 'synthetic-integration-secret'
    const tabId = 'synthetic-integration-tab'
    let tabOrigin = origin
    let descriptorPath: string | undefined
    let server: ReturnType<typeof createServer> | undefined
    let context: Context | undefined

    class FakeWebSocket extends EventTarget {
      static readonly expressions: string[] = []
      static evaluateInjection: ((expression: string) => unknown) | undefined

      constructor(_url: string) {
        super()
        queueMicrotask(() => this.dispatchEvent(new Event('open')))
      }

      send(raw: string): void {
        const request = JSON.parse(raw) as { id?: number; params?: { expression?: string } }
        const expression = request.params?.expression ?? ''
        FakeWebSocket.expressions.push(expression)
        if (expression.includes('const expected=') && FakeWebSocket.evaluateInjection !== undefined) {
          void Promise.resolve(FakeWebSocket.evaluateInjection(expression)).then((value) => {
            this.dispatchEvent(new MessageEvent('message', {
              data: JSON.stringify({ id: request.id, result: { result: { value } } }),
            }))
          })
          return
        }
        const value = expression.includes('const expected=')
          ? 'submitted'
          : {
            required: true,
            formVisible: true,
            authenticated: false,
            gateVisible: false,
            canOpenInPlace: false,
            warningVisible: false,
            fields: [],
          }
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify({ id: request.id, result: { result: { value } } }),
        })))
      }

      close(): void {}
    }

    try {
      vi.stubGlobal('WebSocket', FakeWebSocket)
      const secureLogin = await import('../src/secure-login.ts')
      const webServer = await new Promise<{ host: string; close: () => Promise<void> }>((resolve) => {
        server = createServer((request, response) => {
          if (request.url !== '/json/list') {
            response.writeHead(404)
            response.end()
            return
          }
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify([{
            id: tabId,
            type: 'page',
            url: tabOrigin + '/login',
            webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/synthetic',
          }]))
        })
        server.listen(0, '127.0.0.1', () => {
          const address = server?.address()
          if (address === null || typeof address === 'string' || address === undefined) {
            throw new Error('integration server did not publish a TCP address')
          }
          resolve({
            host: `127.0.0.1:${address.port}`,
            close: async () =>{  await new Promise<void>((done, reject) => {
              server?.close((error) =>{  error === undefined ? done() : reject(error) })
            }) },
          })
        })
      })
      const descriptorDir = join(tmpdir(), 'phoenix-mini-browser-cdp')
      await mkdir(descriptorDir, { recursive: true })
      descriptorPath = join(descriptorDir,
        (randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')).slice(0, 64) + '.json')
      await writeFile(descriptorPath, JSON.stringify({
        endpoint: `http://${webServer.host}`,
        pid: process.pid,
      }), { encoding: 'utf8', flag: 'w' })

      let handler: ((request: unknown, response: unknown) => Promise<void>) | undefined
      secureLogin.registerSecureLogin({
        webServer: {
          register(route: { handler: typeof handler }) {
            handler = route.handler
            return () => {}
          },
        },
      } as never)
      expect(handler).toBeDefined()

      const saved = await invokeRoute(handler as never, 'POST', '/phoenix-secure-login/save', webServer.host, {
        origin,
        tabId,
        account,
        secret,
        automatic: true,
        extras: { 'extra:0': 'synthetic-tenant' },
      })
      expect(saved.code).toBe(200)
      expect(JSON.parse(saved.body)).toMatchObject({ saved: true, automatic: true, profile: 'personal' })
      expect(saved.body).not.toContain(secret)

      const status = await invokeRoute(
        handler as never, 'GET', `/phoenix-secure-login/status?origin=${encodeURIComponent(origin)}`, webServer.host,
      )
      expect(status.code).toBe(200)
      expect(JSON.parse(status.body)).toMatchObject({
        saved: true,
        automatic: true,
        profile: 'personal',
      })
      expect((JSON.parse(status.body) as { profiles: unknown[] }).profiles[0]).toEqual({
        id: 'personal', source: 'dpapi', saved: true, automatic: true,
      })
      expect(status.body).not.toContain(secret)

      context = new Context()
      secureLogin.registerBrowserLoginEvents(context)
      await expect(context.serial('credentials/web-login-status', origin)).resolves.toEqual({
        saved: true, automatic: true,
      })
      await expect(context.serial('credentials/web-login-resolve', origin)).resolves.toEqual({
        authorized: true, account, secret, extras: { 'extra:0': 'synthetic-tenant' },
      })

      const formDocument = (() => {
        const inputPrototype = {}
        Object.defineProperty(inputPrototype, 'value', {
          configurable: true,
          get(this: { currentValue?: string }) { return this.currentValue ?? '' },
          set(this: { currentValue?: string }, value: string) { this.currentValue = value },
        })
        const browserWindow = {
          HTMLInputElement: { prototype: inputPrototype },
          Event: class { constructor(readonly type: string, readonly options: unknown) {} },
        }
        const makeInput = (type: string, name: string, required = false) => {
          const input = {
            type, name, id: '', autocomplete: '', disabled: false, readOnly: false,
            required, placeholder: '', currentValue: '', form: undefined as unknown,
            ownerDocument: { defaultView: browserWindow },
            getClientRects: () => [1],
            dispatchEvent: () => true,
          }
          return input
        }
        const accountInput = makeInput('text', 'username')
        const passwordInput = makeInput('password', 'password')
        const tenantInput = makeInput('text', 'tenant', true)
        const unrelatedInput = makeInput('email', 'newsletter')
        let submitted = false
        const submit = { type: 'submit', disabled: false, getClientRects: () => [1],
          textContent: 'Ingresar', value: '', click: () => { submitted = true } }
        const form = {
          action: origin + '/login',
          contains: (element: unknown) => [accountInput, passwordInput, tenantInput].includes(element as typeof accountInput),
          querySelectorAll: (selector: string) => selector === 'input'
            ? [accountInput, passwordInput, tenantInput] : [submit],
          querySelector: () => submit,
          requestSubmit: () => { submitted = true },
        }
        accountInput.form = form
        passwordInput.form = form
        tenantInput.form = form
        const document = {
          querySelectorAll: (selector: string) => selector === 'iframe' ? []
            : selector === 'input' ? [unrelatedInput, accountInput, passwordInput, tenantInput] : [],
        }
        return { browserWindow, document, form, location: { origin, href: origin + '/login' }, accountInput, passwordInput,
          tenantInput, unrelatedInput, get submitted() { return submitted } }
      })()
      FakeWebSocket.evaluateInjection = expression => new Function(
        'document', 'location', 'window', `return ${expression}`,
      )(formDocument.document, formDocument.location, formDocument.browserWindow)
      const used = await invokeRoute(handler as never, 'POST', '/phoenix-secure-login/use', webServer.host, {
        origin,
        tabId,
        manual: false,
      })
      FakeWebSocket.evaluateInjection = undefined
      expect(used.code).toBe(200)
      expect(JSON.parse(used.body)).toMatchObject({ status: 'submitted', profile: 'personal' })
      expect(used.body).not.toContain(account)
      expect(used.body).not.toContain(secret)
      expect(formDocument.accountInput.currentValue).toBe(account)
      expect(formDocument.passwordInput.currentValue).toBe(secret)
      expect(formDocument.tenantInput.currentValue).toBe('synthetic-tenant')
      expect(formDocument.unrelatedInput.currentValue).toBe('')
      expect(formDocument.submitted).toBe(true)
      expect(FakeWebSocket.expressions.some(expression => expression.includes(account))).toBe(true)
      expect(FakeWebSocket.expressions.some(expression => expression.includes(secret))).toBe(true)

      formDocument.form.action = 'https://other-origin.invalid/login'
      formDocument.accountInput.currentValue = ''
      formDocument.passwordInput.currentValue = ''
      FakeWebSocket.evaluateInjection = expression => new Function(
        'document', 'location', 'window', `return ${expression}`,
      )(formDocument.document, formDocument.location, formDocument.browserWindow)
      const refused = await invokeRoute(handler as never, 'POST', '/phoenix-secure-login/use', webServer.host, {
        origin, tabId, manual: false,
      })
      FakeWebSocket.evaluateInjection = undefined
      expect(JSON.parse(refused.body)).toMatchObject({ status: 'origin-changed' })
      expect(formDocument.accountInput.currentValue).toBe('')
      expect(formDocument.passwordInput.currentValue).toBe('')

      // These records are valid DPAPI envelopes but contain invalid decrypted
      // JSON. The routes must reject them through the same parser used by the
      // production read path, without reflecting any fixture value.
      const malformedOrigin = 'https://malformed-vault.invalid'
      const malformedSecret = 'synthetic-malformed-secret'
      const malformedUseCases: ReadonlyArray<Record<string, unknown>> = [
        { origin: malformedOrigin, account: 7, secret: malformedSecret },
        { origin: malformedOrigin, account: 'synthetic-account', secret: malformedSecret,
          extras: { 'extra:4': 'out-of-range' } },
        { origin: malformedOrigin, account: 'a'.repeat(4097), secret: malformedSecret },
        { origin: malformedOrigin, account: 'synthetic-account', secret: 's'.repeat(16385) },
      ]
      tabOrigin = malformedOrigin
      for (const fixture of malformedUseCases) {
        await writeDpapiFixture(isolatedHome, malformedOrigin, fixture)
        const rejected = await invokeRoute(handler as never, 'POST', '/phoenix-secure-login/use', webServer.host, {
          origin: malformedOrigin, tabId, manual: false,
        })
        expect(rejected.code).toBe(503)
        expect(JSON.parse(rejected.body)).toMatchObject({ reason: 'vault-unavailable' })
        expect(rejected.body).not.toContain(malformedSecret)
      }

      const sourceOrigin = 'https://www.juancitosport.com.do'
      const destinationOrigin = 'https://deportes.juancitosport.com.do'
      const malformedAdoptCases: ReadonlyArray<Record<string, unknown>> = [
        { origin: sourceOrigin, account: false, secret: malformedSecret },
        { origin: sourceOrigin, account: 'synthetic-account', secret: malformedSecret,
          extras: { 'extra:9': 'out-of-range' } },
        { origin: sourceOrigin, account: 'synthetic-account', secret: 's'.repeat(16385) },
      ]
      tabOrigin = destinationOrigin
      for (const fixture of malformedAdoptCases) {
        await writeDpapiFixture(isolatedHome, sourceOrigin, fixture)
        const rejected = await invokeRoute(handler as never, 'POST', '/phoenix-secure-login/adopt-related', webServer.host, {
          origin: destinationOrigin, sourceOrigin, consent: true, tabId, profile: 'personal', automatic: false,
        })
        expect(rejected.code).toBe(503)
        expect(JSON.parse(rejected.body)).toMatchObject({ reason: 'vault-unavailable' })
        expect(rejected.body).not.toContain(malformedSecret)
      }

      tabOrigin = origin
      const remembered = await invokeRoute(handler as never, 'POST', '/phoenix-secure-login/remember', webServer.host, {
        origin,
        tabId,
        automatic: false,
      })
      expect(remembered.code).toBe(200)
      // Metadata and denial do not decrypt. A damaged sealed payload must
      // still report the selected record and honor its explicit denial.
      for (const name of await readdir(join(isolatedHome, 'secure-logins'))) {
        const path = join(isolatedHome, 'secure-logins', name)
        const row = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
        if (typeof row.sealed === 'string') {
          await writeFile(path, JSON.stringify({ ...row, sealed: 'not-a-dpapi-envelope' }))
        }
      }
      await expect(context.serial('credentials/web-login-status', origin)).resolves.toEqual({
        saved: true, automatic: false,
      })
      await expect(context.serial('credentials/web-login-resolve', origin)).resolves.toEqual({
        authorized: false,
      })
    } finally {
      await context?.fiber.dispose()
      if (descriptorPath !== undefined) await rm(descriptorPath, { force: true })
      if (server?.listening === true) await new Promise<void>(done => server?.close(() =>{  done() }))
      vi.unstubAllGlobals()
      vi.resetModules()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(isolatedHome, { recursive: true, force: true })
    }
  }, 60_000)
})
