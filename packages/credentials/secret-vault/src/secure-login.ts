/**
 * User-only secure website logins. Values travel from the in-chat protected form
 * directly to this loopback broker, never through agent messages or MCP arguments.
 * Windows DPAPI CurrentUser protects each origin-bound record at rest.
 */
import type { Context } from '@phoenix-ai/cordis'
import type {} from '@phoenix-ai/dsh-host-webserver'
import { originCredentialRef, type CredentialProvider } from '@phoenix-ai/dsh-credentials'
import { accountProvisionDecision, loginProfile, preferredLoginProfile, type LoginProfile, type LoginProfileInfo } from './identity-registry.ts'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'

interface LoginRecord { version: 1; origin: string; automatic: boolean; sealed: string }
interface LoginContent { origin: string; account: string; secret: string; extras?: Record<string, string> }
interface BrowserTab { id: string; type?: string; url: string; webSocketDebuggerUrl?: string }
const PREFIX = '/phoenix-secure-login'
const STORE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'secure-logins')
const SHARED_BROWSER = join(tmpdir(), 'phoenix-browser-cdp.json')
const SCOPED_BROWSER_DIR = join(tmpdir(), 'phoenix-mini-browser-cdp')
const SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json',
  '$body = [Convert]::FromBase64String($payload.body)',
  '$entropy = [Convert]::FromBase64String($payload.entropy)',
  '$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser',
  'if ($payload.mode -eq "protect") { $result = [System.Security.Cryptography.ProtectedData]::Protect($body, $entropy, $scope) }',
  'elseif ($payload.mode -eq "unprotect") { $result = [System.Security.Cryptography.ProtectedData]::Unprotect($body, $entropy, $scope) }',
  'else { throw "Invalid operation" }',
  '[Console]::Out.Write([Convert]::ToBase64String($result))',
].join('\n')

/** Only complete secure web origins are accepted, with loopback HTTP for development. */
export function loginOrigin(raw: string): string {
  const parsed = new URL(raw)
  if (parsed.username || parsed.password || parsed.origin === 'null') throw new Error('Origen no válido')
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error('Solo HTTPS')
  return parsed.origin
}
/**
 * A previously visited embedded module is a separate, protected origin.
 * Show only that a related access exists; NEVER share or replay its secret
 * across origins automatically. The user must approve an explicit copy.
 */
export function relatedCredentialOrigin(origin: string): string | undefined {
  return origin === 'https://www.juancitosport.com.do'
    ? 'https://deportes.juancitosport.com.do' : undefined
}
function filename(origin: string, profile: LoginProfile = 'personal'): string {
  const suffix = profile === 'kira' ? '.kira.dpapi.json' : '.dpapi.json'
  return join(STORE, createHash('sha256').update(origin).digest('hex') + suffix)
}
function primaryFilename(origin: string): string {
  return join(STORE, createHash('sha256').update(origin).digest('hex') + '.primary.json')
}
function entropy(origin: string, profile: LoginProfile = 'personal'): string {
  // Preserve exact personal-vault entropy for backwards compatibility.
  return createHash('sha256').update('phoenix-login-v1:' + origin
    + (profile === 'kira' ? ':kira' : '')).digest('base64')
}
async function readPrimary(origin: string): Promise<LoginProfile | undefined> {
  try {
    const row: unknown = JSON.parse(await readFile(primaryFilename(origin), 'utf8'))
    if (row && typeof row === 'object' && 'profile' in row
      && (row.profile === 'personal' || row.profile === 'kira')) return row.profile
  } catch { /* Newly discovered sites have no preference yet. */ }
  return undefined
}
async function setPrimary(origin: string, profile: LoginProfile): Promise<void> {
  await mkdir(STORE, { recursive: true, mode: 0o700 })
  const path = primaryFilename(origin)
  const temp = path + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temp, JSON.stringify({ version: 1, profile }), { mode: 0o600, flag: 'wx' })
    await rename(temp, path)
  } finally { await rm(temp, { force: true }).catch(() => {}) }
}

/** Secret data only on child stdin, never in process arguments, stdout errors or logs. */
async function dpapi(mode: 'protect' | 'unprotect', body: string, origin: string, profile: LoginProfile = 'personal'): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Bóveda de Windows no disponible')
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(SCRIPT, 'utf16le').toString('base64'),
    ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
    let result = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(result.trim())
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('La bóveda no respondió'))
    }, 12_000)
    child.on('error', () => finish(new Error('La bóveda no está disponible')))
    child.stdout.on('data', (chunk: Buffer) => {
      result += chunk.toString('utf8')
      if (result.length > 65_536) {
        child.kill()
        finish(new Error('Respuesta de la bóveda demasiado grande'))
      }
    })
    child.on('close', code => {
      if (code !== 0 || !result.trim()) finish(new Error('Operación segura rechazada'))
      else finish()
    })
    child.stdin.on('error', () => { /* Process close reports a sanitized failure. */ })
    child.stdin.end(JSON.stringify({ mode, body, entropy: entropy(origin, profile) }))
  })
}
/** Backward-compatible access to accounts previously saved via Phoenix credentials.
 * This is read only inside the trusted host; values never cross the model wire.
 */
async function legacyLogin(vault: CredentialProvider | undefined, origin: string):
  Promise<{ login: LoginContent; automatic: boolean } | undefined> {
  if (!vault) return undefined
  try {
    const [account, secret, permission] = await Promise.all([
      vault.resolve(originCredentialRef(origin, 'account')),
      vault.resolve(originCredentialRef(origin, 'secret')),
      vault.resolve(originCredentialRef(origin, 'autonomous')),
    ])
    if (!account?.value || !secret?.value) return undefined
    return {
      login: { origin, account: account.value, secret: secret.value },
      automatic: permission?.value === 'true' || permission?.value === '1',
    }
  } catch { return undefined }
}

async function load(origin: string, profile: LoginProfile = 'personal'): Promise<LoginRecord | undefined> {
  try {
    const row = JSON.parse(await readFile(filename(origin, profile), 'utf8')) as LoginRecord
    return row.version === 1 && row.origin === origin && typeof row.sealed === 'string'
      && typeof row.automatic === 'boolean' ? row : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    // An unreadable or damaged record is not an absent credential.
    throw new Error('No se pudo leer el acceso cifrado')
  }
}
async function store(origin: string, account: string, secret: string, automatic: boolean,
  extras?: Record<string, string>, profile: LoginProfile = 'personal'): Promise<void> {
  const body = Buffer.from(JSON.stringify({ origin, account, secret,
    ...(extras === undefined ? {} : { extras }) } satisfies LoginContent), 'utf8').toString('base64')
  const sealed = await dpapi('protect', body, origin, profile)
  const row: LoginRecord = { version: 1, origin, automatic, sealed }
  await mkdir(STORE, { recursive: true, mode: 0o700 })
  const temporary = filename(origin, profile) + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify(row), { mode: 0o600, flag: 'wx' })
    await rename(temporary, filename(origin, profile))
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}
/** Change explicit auto-login consent without asking for an already saved password. */
async function setRememberedLogin(origin: string, profile: LoginProfile, automatic: boolean,
  vault?: CredentialProvider): Promise<void> {
  const saved = await load(origin, profile)
  if (!saved) {
    const legacy = profile === 'personal' ? await legacyLogin(vault, origin) : undefined
    if (!legacy) throw new Error('No existe un acceso guardado')
    await store(origin, legacy.login.account, legacy.login.secret, automatic, legacy.login.extras, profile)
    return
  }
  const path = filename(origin, profile)
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify({ ...saved, automatic } satisfies LoginRecord),
      { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }).catch(() => {}) }
}
async function listProfiles(origin: string, vault?: CredentialProvider): Promise<LoginProfileInfo[]> {
  const [personal, kira] = await Promise.all([load(origin), load(origin, 'kira')])
  const legacy = personal ? undefined : await legacyLogin(vault, origin)
  return [
    { id: 'personal', saved: Boolean(personal || legacy),
      automatic: personal?.automatic ?? legacy?.automatic ?? false,
      source: personal ? 'dpapi' : legacy ? 'legacy-vault' : 'none' },
    { id: 'kira', saved: Boolean(kira), automatic: kira?.automatic ?? false,
      source: kira ? 'dpapi' : 'none' },
  ]
}
async function activeProfile(origin: string, profiles: readonly LoginProfileInfo[]): Promise<LoginProfile> {
  return preferredLoginProfile(profiles, await readPrimary(origin))
}
function loopbackRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress ?? ''
  const host = req.headers.host ?? ''
  const hostname = (() => { try { return new URL('http://' + host).hostname } catch { return '' } })()
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)
    && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    && req.headers['x-phoenix-secure-login'] === '1'
    && req.headers['sec-fetch-site'] !== 'cross-site'
    && (req.method !== 'POST' || req.headers.origin === 'http://' + host)
}
async function input(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += part.length
    if (size > 32_768) throw new Error('Formulario demasiado grande')
    chunks.push(part)
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('Formulario inválido')
  return body as Record<string, unknown>
}
function respond(res: ServerResponse, code: number, body: Record<string, unknown>): void {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}
async function tabForLogin(tabId: string, origin: string): Promise<BrowserTab> {
  // Secure Ask receives a concrete tabId. Resolve it in the actual chat
  // Chromium instance, not the global descriptor of whichever chat ran last.
  const names = await readdir(SCOPED_BROWSER_DIR).catch(() => [] as string[])
  const descriptors = [SHARED_BROWSER, ...names.filter(name => /^[a-f0-9]{64}\.json$/u.test(name))
    .map(name => join(SCOPED_BROWSER_DIR, name))]
  const matches = await Promise.all(descriptors.map(async file => {
    try {
      const descriptor = JSON.parse(await readFile(file, 'utf8')) as { endpoint?: string; pid?: number }
      if (!descriptor.endpoint || !Number.isInteger(descriptor.pid) || (descriptor.pid ?? 0) < 1) return undefined
      process.kill(descriptor.pid as number, 0)
      const base = new URL(descriptor.endpoint)
      if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
        || base.username || base.password || base.pathname !== '/') return undefined
      const response = await fetch(new URL('/json/list', base), { signal: AbortSignal.timeout(2_500) })
      if (!response.ok) return undefined
      const rows = await response.json() as BrowserTab[]
      return rows.find(row => row.id === tabId && row.type === 'page')
    } catch { return undefined }
  }))
  const tab = matches.find(row => row !== undefined)
  if (!tab?.webSocketDebuggerUrl || loginOrigin(tab.url) !== origin) {
    throw new Error('La pestaña no coincide con el sitio autorizado de esta conversación')
  }
  const socket = new URL(tab.webSocketDebuggerUrl)
  if (socket.protocol !== 'ws:' || !['localhost', '127.0.0.1', '[::1]'].includes(socket.hostname)) {
    throw new Error('Conexión CDP no permitida')
  }
  return tab
}


/** Detect a visible login even when a modal appeared without navigation.
 * Includes same-origin iframes; never inspect cross-origin frame secrets.
 * Detection failures are errors, NOT “no login needed”.
 */
export function loginDetectionExpression(): string {
  return `(() => {
    const roots = [document];
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        const child = frame.contentDocument;
        if (child && child.location.origin === location.origin) roots.push(child);
      } catch { /* A cross-origin identity provider is a separate site. */ }
    }
    const visible = (e) => !e.disabled && !e.readOnly && e.getClientRects().length > 0;
    return roots.some(doc => {
      const fields = Array.from(doc.querySelectorAll('input')).filter(visible);
      const passwords = fields.filter(e => e.type === 'password');
      if (passwords.length !== 1) return false;
      const pass = passwords[0];
      const account = fields.find(e => e !== pass
        && (e.autocomplete === 'username' || e.type === 'email'
          || /user|email|login|account/i.test((e.name||'') + ' ' + (e.id||''))))
        || fields.find(e => e !== pass && ['text','email','tel'].includes(e.type));
      return Boolean(account);
    });
  })()`
}

export interface LoginInputHint {
  key: string
  role: 'account' | 'secret' | 'extra'
  label: string
  placeholder: string
  inputType: 'text' | 'email' | 'tel' | 'password' | 'number'
  required: boolean
}
export interface LoginGateState {
  required: boolean
  formVisible: boolean
  authenticated?: boolean
  gateVisible: boolean
  canOpenInPlace: boolean
  warningVisible: boolean
  fields: LoginInputHint[]
}
/** Inspect a login gate without reading fields, or open exactly one in-page login trigger.
 * Never navigate away, submit an unrelated form, or expose DOM text to the model.
 */
export function loginGateExpression(action: 'inspect' | 'open' = 'inspect'): string {
  const expression = `(() => {
    const roots = [document];
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        const child = frame.contentDocument;
        if (child && child.location.origin === location.origin) roots.push(child);
      } catch {}
    }
    const visible = e => !e.disabled && !e.readOnly && e.getClientRects().length > 0;
    // "Mi cuenta" is frequently visible WHILE logged in; it is not a login requirement.
    const signIn = /^(?:ingresar|entrar|acceder|iniciar sesi[oó]n|identificarse|log ?in|sign ?in)$/i;
    const triggers = roots.flatMap(doc =>
      [...doc.querySelectorAll('button,a,[role="button"],input[type="button"]')]
        .filter(e => visible(e) && signIn.test((e.innerText||e.textContent||e.value||'').trim())));
    const forms = roots.filter(doc => {
      const fields = [...doc.querySelectorAll('input')].filter(visible);
      return fields.some(e => e.type === 'password')
        && fields.some(e => ['text','email','tel'].includes(e.type) ||
          e.autocomplete === 'username');
    });
    const warningVisible = roots.some(doc =>
      /(?:por favor ingrese|debe iniciar sesi[oó]n|inicia sesi[oó]n para|please (?:sign in|log in)|login required|sign in to continue)/i
        .test((doc.body?.innerText||'').slice(0,12000)));
    const inPlace = el => {
      if (el.tagName !== 'A' || !el.getAttribute('href')) return true;
      try {
        const target = new URL(el.href, location.href);
        return target.origin === location.origin
          && target.pathname === location.pathname
          && target.search === location.search;
      } catch { return false; }
    };
    // Responsive layouts can expose multiple equivalent "Ingresar" controls.
    // Prefer a safe same-page entry point; never click a form submit here.
    const inPlaceTriggers = triggers.filter(el => inPlace(el)
      && !(el.tagName === 'BUTTON' && el.type === 'submit') && !el.closest?.('form'));
    const canOpenInPlace = inPlaceTriggers.length > 0;
    const formVisible = forms.length > 0;
    // A disappeared password field is not sufficient proof of authentication.
    const signOut = /^(?:cerrar sesi[oó]n|finalizar sesi[oó]n|salir de la cuenta|log ?out|sign ?out)$/i;
    const authenticated = !formVisible && roots.some(doc =>
      [...doc.querySelectorAll('button,a,[role="button"]')]
        .some(e => visible(e) && signOut.test((e.innerText||e.textContent||e.value||'').trim())));
    const hints = (() => {
      if (forms.length !== 1) return [];
      const doc = forms[0];
      const fields = [...doc.querySelectorAll('input')].filter(visible);
      const passwords = fields.filter(el => el.type === 'password');
      if (passwords.length !== 1) return [];
      const pass = passwords[0];
      const account = fields.find(el => el !== pass && (
        el.autocomplete === 'username' || el.type === 'email'
        || /(?:user|email|login|account|usuario|correo|tel[eé]fono|documento|c[eé]dula)/i
          .test((el.name||'') + ' ' + (el.id||''))))
        || fields.find(el => el !== pass && ['text','email','tel','number'].includes(el.type));
      if (!account) return [];
      const hint = (el, role, key) => {
        const labels = [];
        const label = el.labels?.[0]?.textContent
          || (el.id && [...doc.querySelectorAll('label[for]')].find(node => node.htmlFor === el.id)?.textContent)
          || el.getAttribute?.('aria-label') || el.placeholder || '';
        const clean = value => String(value||'').replace(/[\\u0000-\\u001f]/g,' ').trim().slice(0,72);
        return { key, role, label: clean(label) || (role === 'secret' ? 'Contraseña' : role === 'account'
          ? 'Usuario o identificador' : 'Dato adicional'), placeholder: clean(el.placeholder),
          inputType: ['email','tel','password','number'].includes(el.type) ? el.type : 'text',
          required: Boolean(el.required) };
      };
      const extra = fields.filter(el => el !== pass && el !== account
        && ['text','email','tel','number'].includes(el.type)
        && el.autocomplete !== 'one-time-code').slice(0, 4);
      return [hint(account,'account','account'), hint(pass,'secret','secret'),
        ...extra.map((el,i) => hint(el,'extra','extra:' + i))];
    })();
    if (__OPEN_LOGIN__ && !formVisible && canOpenInPlace) inPlaceTriggers[0].click();
    return {
      required: !authenticated && (formVisible || triggers.length > 0 || warningVisible),
      formVisible, authenticated,
      gateVisible: triggers.length > 0,
      canOpenInPlace,
      warningVisible,
      fields: hints,
    };
  })()`
  return expression.replace('__OPEN_LOGIN__', action === 'open' ? 'true' : 'false')
}
/** One bounded, trusted-host CDP evaluation against the exact active tab. */
async function inspectLoginGate(tab: BrowserTab, action: 'inspect' | 'open' = 'inspect'): Promise<LoginGateState> {
  return await new Promise<LoginGateState>((resolve, reject) => {
    const ws = new WebSocket(tab.webSocketDebuggerUrl as string)
    let settled = false
    const finish = (value?: LoginGateState, error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ws.close()
      if (error) reject(error)
      else if (value) resolve(value)
      else reject(new Error('La inspección segura no devolvió un estado'))
    }
    const timer = setTimeout(() => finish(undefined, new Error('Chrome no respondió al acceso seguro')), 5_000)
    ws.addEventListener('error', () => finish(undefined, new Error('Conexión segura con Chrome no disponible')))
    ws.addEventListener('open', () => {
      try { ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
        params: { expression: loginGateExpression(action), returnByValue: true } }))
      } catch { finish(undefined, new Error('No se pudo consultar el formulario')) }
    })
    ws.addEventListener('message', event => {
      try {
        const packet = JSON.parse(String(event.data)) as {
          id?: number; error?: unknown; result?: {
            exceptionDetails?: unknown; result?: { value?: LoginGateState }
          }
        }
        if (packet.id !== 1) return
        if (packet.error || packet.result?.exceptionDetails) {
          finish(undefined, new Error('Inspección de acceso rechazada'))
          return
        }
        const value = packet.result?.result?.value
        if (!value || typeof value.required !== 'boolean'
          || typeof value.formVisible !== 'boolean' || typeof value.canOpenInPlace !== 'boolean'
          || typeof value.warningVisible !== 'boolean' || typeof value.gateVisible !== 'boolean'
          || !Array.isArray(value.fields)) {
          finish(undefined, new Error('Estado de acceso no válido'))
          return
        }
        finish(value)
      } catch { finish(undefined, new Error('Respuesta de Chrome no válida')) }
    })
  })
}
/** Prepare a sign-in dialog in-place; preserve all existing selections. */
async function prepareVisibleLogin(tab: BrowserTab): Promise<string | undefined> {
  let state = await inspectLoginGate(tab)
  if (state.formVisible) return undefined
  if (!state.canOpenInPlace) return state.required ? 'login-trigger-requires-attention' : 'login-form-not-found'
  state = await inspectLoginGate(tab, 'open')
  if (!state.required) return 'login-form-not-found'
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise<void>(resolve => setTimeout(resolve, 300))
    state = await inspectLoginGate(tab)
    if (state.formVisible) return undefined
  }
  return 'login-form-not-found'
}

/** Only a sanitized result crosses back to the UI. Credentials never enter a tool result. */
async function injectLogin(tab: BrowserTab, login: LoginContent): Promise<string> {
  const expression = '(async () => {'
    + 'const expected=' + JSON.stringify(login.origin) + ';'
    + 'if(location.origin!==expected) return "origin-changed";'
    + 'const roots=[document];for(const f of document.querySelectorAll("iframe")){try{const d=f.contentDocument;if(d&&d.location.origin===expected)roots.push(d)}catch{}}'
    + 'const visible=e=>!e.disabled&&!e.readOnly&&e.getClientRects().length>0;'
    + 'const candidates=roots.flatMap(d=>{const fields=[...d.querySelectorAll("input")].filter(visible);'
    + 'const passwords=fields.filter(e=>e.type==="password");if(passwords.length!==1)return [];'
    + 'const pass=passwords[0];const account=fields.find(e=>e!==pass&&(e.autocomplete==="username"||e.type==="email"'
    + '||/user|email|login|account|usuario|correo|tel[eé]fono|documento|c[eé]dula/i.test((e.name||"")+" "+(e.id||""))))'
    + '||fields.find(e=>e!==pass&&["text","email","tel","number"].includes(e.type));'
    + 'return account?[{pass,account}]:[];});'
    + 'if(candidates.length!==1) return "login-form-not-found";'
    + 'const {pass,account}=candidates[0];'
    + 'const set=(el,v)=>{const win=el.ownerDocument.defaultView||window;'
    + 'const setter=Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype,"value").set;'
    + 'setter.call(el,v);el.dispatchEvent(new win.Event("input",{bubbles:true}));el.dispatchEvent(new win.Event("change",{bubbles:true}));};'
    + 'set(account,' + JSON.stringify(login.account) + ');'
    + 'set(pass,' + JSON.stringify(login.secret) + ');'
    + 'const extraInputs=roots.flatMap(d=>[...d.querySelectorAll("input")].filter(visible))'
    + '.filter(el=>el!==account&&el!==pass&&["text","email","tel","number"].includes(el.type)'
    + '&&el.autocomplete!=="one-time-code").slice(0,4);'
    + 'const extras=' + JSON.stringify(login.extras ?? {}) + ';'
    + 'for(let i=0;i<extraInputs.length;i++){const key="extra:"+i;'
    + 'if(typeof extras[key]!=="string"){if(extraInputs[i].required)return "additional-login-field-required";continue;}'
    + 'set(extraInputs[i],extras[key]);}'
    + 'await new Promise(resolve=>setTimeout(resolve,80));'
    + 'if(location.origin!==expected) return "origin-changed";'
    + 'const form=pass.form || account.form;'
    + 'if(form){const button=form.querySelector("button[type=submit],input[type=submit]");'
    + 'if(button)button.click();else form.requestSubmit();}'
    + 'else {let root=pass;let clicked=false;for(let depth=0;depth<8;depth++){'
    + 'root=root.parentElement;if(!root)break;'
    + 'const buttons=[...root.querySelectorAll("button,[role=button],input[type=submit]")]'
    + '.filter(e=>/^(?:ingresar|iniciar sesi[oó]n|acceder|entrar|log ?in|sign ?in)$/i'
    + '.test((e.textContent||e.value||"").trim())&&!e.disabled&&e.getClientRects().length>0);'
    + 'if(buttons.length===1){buttons[0].click();clicked=true;break;}}'
    + 'if(!clicked)return "login-form-not-found";}'
    + 'return "submitted";'
    + '})()'
  return await new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(tab.webSocketDebuggerUrl as string)
    let completed = false
    const finish = (error?: Error, status?: string): void => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      ws.close()
      if (error) reject(error)
      else resolve(status ?? 'failed')
    }
    const timer = setTimeout(() => finish(new Error('Chrome no respondió')), 12_000)
    ws.addEventListener('error', () => finish(new Error('Conexión segura con Chrome fallida')))
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: 1, method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }))
    })
    ws.addEventListener('message', event => {
      try {
        const data = JSON.parse(String(event.data)) as {
          id?: number; error?: unknown; result?: { exceptionDetails?: unknown; result?: { value?: unknown } }
        }
        if (data.id !== 1) return
        if (data.error || data.result?.exceptionDetails) return finish(new Error('El formulario rechazó el inicio de sesión'))
        finish(undefined, String(data.result?.result?.value ?? 'failed'))
      } catch { finish(new Error('Respuesta inválida de Chrome')) }
    })
  })
}
async function useLogin(origin: string, tabId: string, manual: boolean,
  profile: LoginProfile, vault?: CredentialProvider): Promise<string> {
  const saved = await load(origin, profile)
  const previous = profile === 'personal' && !saved ? await legacyLogin(vault, origin) : undefined
  if ((!saved && !previous)
    || (!(saved?.automatic ?? previous?.automatic ?? false) && !manual)) return 'not-authorized'
  const tab = await tabForLogin(tabId, origin)
  const login = saved
    ? JSON.parse(Buffer.from(await dpapi('unprotect', saved.sealed, origin, profile), 'base64').toString('utf8')) as LoginContent
    : previous!.login
  if (login.origin !== origin || !login.account || !login.secret) throw new Error('Registro de bóveda inválido')
  const preparation = await prepareVisibleLogin(tab)
  if (preparation !== undefined) return preparation
  const result = await injectLogin(tab, login)
  if (!saved && previous && result === 'submitted') {
    // Migrating must not prevent a successfully initiated login. Keep legacy
    // access in place if DPAPI is unavailable or the migration cannot finish.
    try {
      await store(origin, login.account, login.secret, previous.automatic, login.extras, 'personal')
      // Keep legacy records intact until the owner explicitly removes them.
      // Login migration should never discard a fallback credential.
    } catch { /* A storage problem is not a login failure. */ }
  }
  return result
}

/** Route lives on the host, outside every model-facing MCP tool and session log. */
export function registerSecureLogin(ctx: Context, vault?: CredentialProvider): () => void {
  return ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      if (!loopbackRequest(req)) { respond(res, 403, { error: 'Acceso local no autorizado' }); return }
      try {
        const route = new URL(req.url ?? '/', 'http://localhost')
        if (req.method === 'GET' && route.pathname === PREFIX + '/status') {
          const origin = loginOrigin(route.searchParams.get('origin') ?? '')
          const profiles = await listProfiles(origin, vault)
          const selected = await activeProfile(origin, profiles)
          const current = profiles.find(p => p.id === selected)!
          const relatedOrigin = !current.saved ? relatedCredentialOrigin(origin) : undefined
          const relatedProfiles = relatedOrigin ? await listProfiles(relatedOrigin, vault) : []
          const related = relatedProfiles.some(item => item.saved)
            ? { relatedOrigin, relatedProfile: preferredLoginProfile(relatedProfiles), relatedSaved: true }
            : {}
          respond(res, 200, {
            saved: current.saved, automatic: current.automatic, source: current.source,
            profile: selected, profiles, ...related,
          })
          return
        }
        if (req.method !== 'POST') { respond(res, 405, { error: 'Operación no permitida' }); return }
        const payload = await input(req)
        const origin = loginOrigin(String(payload.origin ?? ''))
        if (route.pathname === PREFIX + '/select') {
          if (typeof payload.tabId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(payload.tabId)) {
            throw new Error('Pestaña no válida')
          }
          await tabForLogin(payload.tabId, origin)
          const profile = loginProfile(payload.profile)
          const profiles = await listProfiles(origin, vault)
          if (!profiles.some(item => item.id === profile && item.saved)) {
            throw new Error('Esa identidad no tiene acceso guardado')
          }
          await setPrimary(origin, profile)
          const current = profiles.find(item => item.id === profile)!
          respond(res, 200, { saved: true, automatic: current.automatic, profile, profiles })
          return
        }
        if (route.pathname === PREFIX + '/provision-eligibility') {
          // Planning only. Never register accounts merely because a human
          // did not respond or use a restricted/identity-verified service.
          const decision = accountProvisionDecision(origin, payload.authorized === true, false)
          respond(res, 200, { decision, created: false })
          return
        }
        if (route.pathname === PREFIX + '/detect') {
          if (typeof payload.tabId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(payload.tabId)) {
            throw new Error('Pestaña no válida')
          }
          const tab = await tabForLogin(payload.tabId, origin)
          respond(res, 200, { ...await inspectLoginGate(tab) })
          return
        }
        if (route.pathname === PREFIX + '/open') {
          if (typeof payload.tabId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(payload.tabId)) {
            throw new Error('Pestaña no válida')
          }
          const tab = await tabForLogin(payload.tabId, origin)
          const gate = await inspectLoginGate(tab)
          if (!gate.required || gate.formVisible || !gate.canOpenInPlace) {
            respond(res, 200, { ...gate })
            return
          }
          // Same-page, unambiguous login trigger only. No navigation or
          // submission is attempted and no credential ever reaches MCP.
          respond(res, 200, { ...await inspectLoginGate(tab, 'open') })
          return
        }
        if (route.pathname === PREFIX + '/save') {
          const account = payload.account
          const secret = payload.secret
          if (typeof account !== 'string' || !account.trim() || account.length > 4096
            || typeof secret !== 'string' || !secret || secret.length > 16384) {
            throw new Error('Credenciales incompletas')
          }
          // Bind enrollment to the actual visible browser tab, not an arbitrary
          // origin typed in an agent response or a forged sidebar request.
          if (typeof payload.tabId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(payload.tabId)) {
            throw new Error('Pestaña no válida')
          }
          await tabForLogin(payload.tabId, origin)
          const rawExtras = payload.extras
          if (rawExtras !== undefined && (rawExtras === null || typeof rawExtras !== 'object'
            || Array.isArray(rawExtras)
            || Object.keys(rawExtras).length > 4
            || Object.entries(rawExtras).some(([key, value]) =>
              !/^extra:[0-3]$/.test(key) || typeof value !== 'string' || value.length > 4096))) {
            throw new Error('Datos adicionales de acceso no válidos')
          }
          const extras = rawExtras as Record<string, string> | undefined
          const profile = payload.profile === undefined ? 'personal' : loginProfile(payload.profile)
          await store(origin, account, secret, payload.automatic === true, extras, profile)
          if (profile === 'personal') await setPrimary(origin, 'personal')
          const profiles = await listProfiles(origin, vault)
          const selected = await activeProfile(origin, profiles)
          respond(res, 200, { saved: true, automatic: payload.automatic === true, profile: selected,
            profiles })
          return
        }
        if (route.pathname === PREFIX + '/remember') {
          // Explicit click in Secure Ask only. Existing DPAPI ciphertext stays sealed.
          if (typeof payload.tabId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(payload.tabId)
            || typeof payload.automatic !== 'boolean') throw new Error('Solicitud no válida')
          await tabForLogin(payload.tabId, origin)
          const profile = payload.profile === undefined ? 'personal' : loginProfile(payload.profile)
          await setRememberedLogin(origin, profile, payload.automatic, vault)
          await setPrimary(origin, profile)
          const profiles = await listProfiles(origin, vault)
          respond(res, 200, { saved: true, automatic: payload.automatic, profile, profiles })
          return
        }
        if (route.pathname === PREFIX + '/adopt-related') {
          // A human-initiated, specific-site copy: verify the destination tab
          // is genuinely on the intended HTTPS origin before unsealing anything.
          const source = relatedCredentialOrigin(origin)
          if (!source || payload.sourceOrigin !== source || payload.consent !== true
            || typeof payload.tabId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(payload.tabId)) {
            throw new Error('Reutilización entre sitios no autorizada')
          }
          await tabForLogin(payload.tabId, origin)
          const profile = loginProfile(payload.profile)
          const saved = await load(source, profile)
          const legacy = profile === 'personal' && !saved ? await legacyLogin(vault, source) : undefined
          if (!saved && !legacy) throw new Error('No existe un acceso guardado en el módulo')
          const data = saved
            ? JSON.parse(Buffer.from(await dpapi('unprotect', saved.sealed, source, profile), 'base64').toString('utf8')) as LoginContent
            : legacy!.login
          if (data.origin !== source || !data.account || !data.secret) throw new Error('Registro no válido')
          // Automatic login never transfers silently. It is granted only
          // when the person explicitly clicks the separate "never ask" option.
          const automatic = payload.automatic === true
          await store(origin, data.account, data.secret, automatic, data.extras, profile)
          await setPrimary(origin, profile)
          const profiles = await listProfiles(origin, vault)
          respond(res, 200, { saved: true, automatic, profile, profiles })
          return
        }
        if (route.pathname === PREFIX + '/delete') {
          // Deletion is explicit and affects only the named identity.
          const profile = payload.profile === undefined ? 'personal' : loginProfile(payload.profile)
          await rm(filename(origin, profile), { force: true })
          if (profile === 'personal' && vault) {
            await Promise.all([
              vault.unset(originCredentialRef(origin, 'account')),
              vault.unset(originCredentialRef(origin, 'secret')),
              vault.unset(originCredentialRef(origin, 'autonomous')),
            ])
          }
          const profiles = await listProfiles(origin, vault)
          const selected = await activeProfile(origin, profiles)
          const current = profiles.find(item => item.id === selected)!
          respond(res, 200, { saved: current.saved, automatic: current.automatic,
            profile: selected, profiles })
          return
        }
        if (route.pathname === PREFIX + '/use') {
          if (typeof payload.tabId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(payload.tabId)) {
            throw new Error('Pestaña no válida')
          }
          const profiles = await listProfiles(origin, vault)
          const selected = payload.profile === undefined
            ? await activeProfile(origin, profiles) : loginProfile(payload.profile)
          const status = await useLogin(origin, payload.tabId, payload.manual === true, selected, vault)
          respond(res, 200, { status, profile: selected })
          return
        }
        respond(res, 404, { error: 'Ruta desconocida' })
      } catch {
        // NEVER reflect secrets, CDP expressions, PowerShell errors or original payloads.
        respond(res, 400, { error: 'No se pudo completar la operación segura; verifica el sitio y la bóveda.' })
      }
    },
  })
}
