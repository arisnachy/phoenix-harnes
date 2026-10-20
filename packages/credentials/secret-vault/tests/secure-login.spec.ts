import { describe, expect, it } from 'vitest'
import { loginOrigin, loginDetectionExpression, loginGateExpression, relatedCredentialOrigin, registerSecureLogin } from '../src/secure-login.ts'

describe('origin-scoped secure login', () => {
  it('does not mistake a persistent account menu or a logout control for a login requirement', () => {
    const run = new Function('document', 'location', 'URL', 'return ' + loginGateExpression()) as (
      doc: unknown, location: unknown, url: typeof URL
    ) => { required: boolean; gateVisible: boolean; authenticated?: boolean }
    const makeElement = (text: string) => ({
      tagName: 'BUTTON', textContent: text, innerText: text,
      disabled: false, readOnly: false, getClientRects: () => [{}],
    })
    const accountMenu = makeElement('Mi cuenta')
    const logout = makeElement('Cerrar sesión')
    const root = (controls: unknown[]) => ({
      querySelectorAll: (selector: string) =>
        selector === 'iframe' || selector === 'input' ? [] : controls,
      body: { innerText: '' },
    })
    const location = { origin: 'https://example.org', href: 'https://example.org/' }
    expect(run(root([accountMenu]), location, URL)).toMatchObject({
      required: false, gateVisible: false,
    })
    expect(run(root([makeElement('Iniciar sesión'), logout]), location, URL)).toMatchObject({
      required: false, authenticated: true,
    })
    expect(run(root([makeElement('Iniciar sesión')]), location, URL)).toMatchObject({
      required: true, gateVisible: true,
    })
  })

  it('only recognizes a fixed verified related origin, without automatic secret sharing', () => {
    expect(relatedCredentialOrigin('https://www.juancitosport.com.do'))
      .toBe('https://deportes.juancitosport.com.do')
    expect(relatedCredentialOrigin('https://deportes.juancitosport.com.do'))
      .toBe('https://www.juancitosport.com.do')
    expect(relatedCredentialOrigin('https://example.com')).toBeUndefined()
    expect(relatedCredentialOrigin('https://www.juancitosport.com.do.evil.example')).toBeUndefined()
  })

  it('canonicalizes full HTTPS URLs without crossing origins', () => {
    expect(loginOrigin('https://example.org/login?token=hidden')).toBe('https://example.org')
    expect(loginOrigin('https://example.org:8443/login')).toBe('https://example.org:8443')
    expect(loginOrigin('http://localhost:3080/login')).toBe('http://localhost:3080')
    expect(() => loginOrigin('http://example.org/login')).toThrow()
    expect(() => loginOrigin('https://user:password@example.org/login')).toThrow()
    expect(() => loginOrigin('file:///tmp/login')).toThrow()
  })

  it('detects password forms opened in a modal with no form element', () => {
    const script = loginDetectionExpression()
    const evaluate = new Function('document', 'location', 'return ' + script) as (
      document: unknown, location: unknown,
    ) => boolean
    const field = (type: string, name: string) => ({
      type, name, id: '', autocomplete: '', disabled: false, readOnly: false,
      getClientRects: () => [1],
    })
    const root = { querySelectorAll: (selector: string) =>
      selector === 'input' ? [field('text', 'login'), field('password', 'password')] : [] }
    expect(evaluate(root, { origin: 'https://example.org' })).toBe(true)
    const absent = { querySelectorAll: () => [] }
    expect(evaluate(absent, { origin: 'https://example.org' })).toBe(false)
  })

  it('recognizes same-origin iframe forms and ignores inaccessible external frames', () => {
    const evaluate = new Function('document', 'location', 'return ' + loginDetectionExpression()) as (
      document: unknown, location: unknown,
    ) => boolean
    const fields = [
      { type: 'text', name: 'player', disabled: false, readOnly: false,
        autocomplete: '', getClientRects: () => [1] },
      { type: 'password', name: 'password', disabled: false, readOnly: false,
        autocomplete: '', getClientRects: () => [1] },
    ]
    const inside = {
      location: { origin: 'https://example.org' },
      querySelectorAll: (selector: string) => selector === 'input' ? fields : [],
    }
    const frame = { contentDocument: inside }
    const root = { querySelectorAll: (selector: string) => selector === 'iframe' ? [frame] : [] }
    expect(evaluate(root, { origin: 'https://example.org' })).toBe(true)
    expect(evaluate(root, { origin: 'https://other.example.org' })).toBe(false)
  })

  it('recognizes a session-loss warning and opens only an in-place login modal', () => {
    const evaluator = (mode: 'inspect' | 'open', root: unknown, pageUrl = 'https://example.org/sports') =>
      new Function('document', 'location', 'URL', 'return ' + loginGateExpression(mode))(
        root, { origin: 'https://example.org', href: pageUrl, pathname: '/sports', search: '' }, URL,
      ) as { required: boolean; formVisible: boolean; gateVisible: boolean; canOpenInPlace: boolean }
    let clicks = 0
    const trigger = {
      tagName: 'BUTTON', textContent: 'INGRESAR', disabled: false, readOnly: false,
      getClientRects: () => [1], click: () => { clicks++ },
    }
    const root = {
      body: { innerText: 'Por favor ingrese para poder guardar sus apuestas' },
      querySelectorAll: (query: string) => query === 'iframe' || query === 'input'
        ? [] : [trigger],
    }
    expect(evaluator('inspect', root)).toMatchObject({
      required: true, formVisible: false, authenticated: false, gateVisible: true, canOpenInPlace: true,
    })
    expect(clicks).toBe(0)
    expect(evaluator('open', root).required).toBe(true)
    expect(clicks).toBe(1)

    const links = {
      ...root, querySelectorAll: (query: string) => query === 'iframe' || query === 'input'
        ? [] : [{ ...trigger, tagName: 'A', href: 'https://example.org/account/login',
          getAttribute: () => '/account/login' }],
    }
    expect(evaluator('open', links).canOpenInPlace).toBe(false)
    expect(clicks).toBe(1)
  })

  it('opens one safe login dialog even with duplicated responsive sign-in buttons', () => {
    const evaluate = (mode: 'inspect' | 'open', root: unknown) =>
      new Function('document', 'location', 'URL', 'return ' + loginGateExpression(mode))(
        root, { origin: 'https://example.org', href: 'https://example.org/',
          pathname: '/', search: '' }, URL,
      ) as { required: boolean; canOpenInPlace: boolean }
    let clicks = 0
    const trigger = (text: string) => ({
      tagName: 'BUTTON', type: 'button', textContent: text, innerText: text,
      disabled: false, readOnly: false, getClientRects: () => [1],
      closest: () => null, click: () => { clicks++ },
    })
    const root = {
      body: { innerText: '' },
      querySelectorAll: (query: string) => query === 'iframe' || query === 'input'
        ? [] : [trigger('INGRESAR'), trigger('Iniciar sesión')],
    }
    expect(evaluate('inspect', root).canOpenInPlace).toBe(true)
    expect(clicks).toBe(0)
    expect(evaluate('open', root).required).toBe(true)
    expect(clicks).toBe(1)
  })

  it('detects a sign-in form without submitting any other page action', () => {
    const evaluator = new Function('document', 'location', 'URL',
      'return ' + loginGateExpression('open')) as (
      document: unknown, location: unknown, URL: unknown,
    ) => { required: boolean; formVisible: boolean }
    const field = (type: string) => ({ type, readOnly: false, disabled: false,
      autocomplete: '', getClientRects: () => [1] })
    const root = { body: { innerText: '' },
      querySelectorAll: (query: string) => query === 'input'
        ? [field('text'), field('password')] : [] }
    expect(evaluator(root, { origin: 'https://example.org' }, URL)).toMatchObject({
      required: true, formVisible: true,
    })
  })

  it('builds safe site-specific login fields without exposing entered values', () => {
    const evaluator = new Function('document', 'location', 'URL',
      'return ' + loginGateExpression('inspect')) as (d: unknown, l: unknown, u: unknown) => {
        fields: Array<{ key: string; role: string; label: string; inputType: string }>
      }
    const fields = [
      { type: 'tel', name: 'numero', id: '', placeholder: '809 000 0000', required: true,
        readOnly: false, disabled: false, autocomplete: '', getClientRects: () => [1],
        getAttribute: () => null, labels: [{ textContent: 'Número de teléfono' }] },
      { type: 'password', name: 'pass', id: '', placeholder: 'Clave', required: true,
        readOnly: false, disabled: false, autocomplete: '', getClientRects: () => [1],
        getAttribute: () => null, labels: [{ textContent: 'Clave de ingreso' }] },
      { type: 'text', name: 'company', id: '', placeholder: 'Empresa', required: true,
        readOnly: false, disabled: false, autocomplete: '', getClientRects: () => [1],
        getAttribute: () => null, labels: [{ textContent: 'Código de empresa' }] },
    ]
    const doc = { body: { innerText: 'INGRESAR' },
      querySelectorAll: (q: string) => q === 'input' ? fields : [] }
    const result = evaluator(doc, { origin: 'https://example.org' }, URL)
    expect(result.fields).toMatchObject([
      { key: 'account', role: 'account', label: 'Número de teléfono', inputType: 'tel' },
      { key: 'secret', role: 'secret', label: 'Clave de ingreso', inputType: 'password' },
      { key: 'extra:0', role: 'extra', label: 'Código de empresa', inputType: 'text' },
    ])
    expect(JSON.stringify(result.fields)).not.toContain('secret-value')
  })

  it('detects legacy saved account presence without revealing its secret', async () => {
    let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined
    const webServer = { register: (route: { handler: typeof handler }) => {
      handler = route.handler
      return () => {}
    } }
    const vault = { resolve: async (ref: string) => {
      if (ref.endsWith('_ACCOUNT')) return { value: 'private account' }
      if (ref.endsWith('_SECRET')) return { value: 'private secret' }
      if (ref.endsWith('_AUTONOMOUS')) return { value: 'true' }
      return undefined
    } }
    registerSecureLogin({ webServer } as never, vault as never)
    let body = ''
    await handler?.({
      method: 'GET',
      url: '/phoenix-secure-login/status?origin=https%3A%2F%2Fexample.org',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:3080', 'x-phoenix-secure-login': '1' },
    }, {
      writeHead() {}, end(value: string) { body = value },
    })
    expect(JSON.parse(body)).toEqual({
      saved: true, automatic: true, source: 'legacy-vault', profile: 'personal',
      profiles: [
        { id: 'personal', saved: true, automatic: true, source: 'legacy-vault' },
        { id: 'kira', saved: false, automatic: false, source: 'none' },
      ],
    })
    expect(body).not.toContain('private')
  })

  it('recognizes saved parent-portal access while Kira visits the embedded sports module', async () => {
    let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined
    const original = 'https://www.juancitosport.com.do'
    registerSecureLogin({ webServer: { register: (route: { handler: typeof handler }) => {
      handler = route.handler
      return () => {}
    } } } as never, {
      resolve: async (ref: string) => {
        if (!ref.endsWith('_ACCOUNT') && !ref.endsWith('_SECRET')) return undefined
        const expected = (await import('@phoenix-ai/dsh-credentials'))
          .originCredentialRef(original, ref.endsWith('_ACCOUNT') ? 'account' : 'secret')
        return ref === expected ? { value: 'SECRET_MUST_NOT_APPEAR' } : undefined
      },
    } as never)
    let body = ''
    await handler?.({
      method: 'GET',
      url: '/phoenix-secure-login/status?origin=https%3A%2F%2Fdeportes.juancitosport.com.do',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:3080', 'x-phoenix-secure-login': '1' },
    }, { writeHead() {}, end(value: string) { body = value } })
    const status = JSON.parse(body) as Record<string, unknown>
    expect(status).toMatchObject({
      saved: false, relatedSaved: true, relatedOrigin: original,
      relatedProfile: 'personal',
    })
    expect(body).not.toContain('SECRET_MUST_NOT_APPEAR')
  })

  it('rejects non-loopback requests before even accessing the vault', async () => {
    let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined
    const webServer = {
      register: (route: { path: string; handler: typeof handler }) => {
        expect(route.path).toBe('/phoenix-secure-login')
        handler = route.handler
        return () => {}
      },
    }
    registerSecureLogin({ webServer } as never)
    expect(handler).toBeDefined()
    let code = 0
    let body = ''
    const res = {
      writeHead(status: number) { code = status },
      end(value: string) { body = value },
    }
    await handler?.({
      method: 'GET',
      url: '/phoenix-secure-login/status?origin=https%3A%2F%2Fexample.org',
      socket: { remoteAddress: '192.0.2.42' },
      headers: { host: '127.0.0.1:3080', 'x-phoenix-secure-login': '1' },
    }, res)
    expect(code).toBe(403)
    expect(body).not.toContain('password')
  })

  it('rejects cross-origin POST requests even from loopback', async () => {
    let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined
    const webServer = { register: (route: { handler: typeof handler }) => {
      handler = route.handler
      return () => {}
    } }
    registerSecureLogin({ webServer } as never)
    let status = 0
    await handler?.({
      method: 'POST',
      url: '/phoenix-secure-login/use',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:3080', origin: 'https://evil.example',
        'x-phoenix-secure-login': '1' },
    }, {
      writeHead(value: number) { status = value },
      end() {},
    })
    expect(status).toBe(403)
  })
  it('reports related credential existence without exposing it or treating it as site authorization', async () => {
    let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined
    registerSecureLogin({ webServer: { register: (route: { handler: typeof handler }) => {
      handler = route.handler
      return () => {}
    } } } as never, {
      resolve: async (ref: string) => {
        if (!ref.includes('ACCOUNT') && !ref.includes('SECRET')) return undefined
        const expected = (await import('@phoenix-ai/dsh-credentials'))
          .originCredentialRef('https://deportes.juancitosport.com.do',
            ref.endsWith('_ACCOUNT') ? 'account' : 'secret')
        return ref === expected ? { value: 'SENSITIVE_TEST_VALUE' } : undefined
      },
    } as never)
    let body = ''
    await handler?.({
      method: 'GET',
      url: '/phoenix-secure-login/status?origin=https%3A%2F%2Fwww.juancitosport.com.do',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:3080', 'x-phoenix-secure-login': '1' },
    }, { writeHead() {}, end(value: string) { body = value } })
    const status = JSON.parse(body) as Record<string, unknown>
    expect(status.saved).toBe(false)
    expect(status.relatedSaved).toBe(true)
    expect(status.relatedOrigin).toBe('https://deportes.juancitosport.com.do')
    expect(body).not.toContain('SENSITIVE_TEST_VALUE')
  })

})
