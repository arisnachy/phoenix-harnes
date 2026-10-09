/**
 * Current-user Windows DPAPI vault shared by native Desktop and the chat MiniBrowser.
 * No model-facing action receives a password and plaintext never touches disk.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PREFIX = 'dpapi-current-user:v1:'
const MAX_CREDENTIAL = 16_384
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$raw = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($raw)
try {
  if (__MODE__ -eq 'protect') {
    $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  } else {
    $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} finally {
  [Array]::Clear($bytes, 0, $bytes.Length)
}
`

/**
 * Canonical origin for one exact authorized browser site.
 * @param value - Origin or current page URL.
 * @returns Canonical HTTPS origin or approved local HTTP origin.
 */
export function secureBrowserOrigin(value: string): string {
  const url = new URL(value)
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username !== '' || url.password !== '') throw new Error('El vault exige un sitio HTTPS válido.')
  return url.origin
}

/**
 * Whether Windows DPAPI is available for this native user.
 * @returns True only on Windows.
 */
export function browserVaultSupported(): boolean {
  return process.platform === 'win32'
}

function vaultDirectory(): string {
  const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  return join(base, 'Phoenix', 'browser-vault')
}
function vaultFile(origin: string): string {
  return join(vaultDirectory(), createHash('sha256').update(secureBrowserOrigin(origin)).digest('hex').toUpperCase() + '.json')
}
function invokeDpapi(mode: 'protect' | 'unprotect', bytes: Buffer): Promise<Buffer> {
  if (!browserVaultSupported()) throw new Error('El vault cifrado requiere Phoenix en Windows.')
  return new Promise((resolve, reject) => {
    const command = SCRIPT.replace('__MODE__', "'" + mode + "'")
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    })
    const chunks: Buffer[] = []
    let errorText = ''
    let size = 0
    let settled = false
    const done = (cause?: Error, result?: Buffer): void => {
      if (settled) return
      settled = true
      bytes.fill(0)
      if (cause) reject(new Error('No se pudo acceder al vault protegido de Windows.'))
      else resolve(result as Buffer)
    }
    child.once('error', () => done(new Error('PowerShell unavailable')))
    child.stdout.on('data', (piece: Buffer) => {
      size += piece.length
      if (size > 90_000) { child.kill(); return }
      chunks.push(piece)
    })
    child.stderr.on('data', (piece: Buffer) => { errorText += piece.toString().slice(0, 200) })
    child.once('close', code => {
      if (code !== 0 || errorText.length > 0 || size > 90_000) { done(new Error('DPAPI failed')); return }
      try { done(undefined, Buffer.from(Buffer.concat(chunks).toString('utf8').trim(), 'base64')) }
      catch { done(new Error('Invalid DPAPI reply')) }
    })
    child.stdin.end(bytes.toString('base64'))
  })
}
async function protect(value: string): Promise<string> {
  const encrypted = await invokeDpapi('protect', Buffer.from(value, 'utf8'))
  try { return PREFIX + encrypted.toString('base64') }
  finally { encrypted.fill(0) }
}
async function unprotect(value: string): Promise<string> {
  if (!value.startsWith(PREFIX)) throw new Error('Registro del vault incompatible.')
  const decrypted = await invokeDpapi('unprotect', Buffer.from(value.slice(PREFIX.length), 'base64'))
  try { return decrypted.toString('utf8') }
  finally { decrypted.fill(0) }
}
type VaultEntry = { Schema: number; Origin: string; Account: string; Secret: string }

/**
 * Return credential availability without reading any secret.
 * @param origin - Exact authorized site.
 * @returns Whether a DPAPI-protected entry exists for this origin.
 */
export function hasSecureBrowserLogin(origin: string): boolean {
  return browserVaultSupported() && existsSync(vaultFile(origin))
}

/**
 * Write an account + password into the same DPAPI layout used by Phoenix Desktop.
 * @param origin - Exact authorized site origin.
 * @param account - Credential entered by the person, never the model.
 * @param secret - Password entered by the person, never the model.
 * @returns Completion after the encrypted record is written.
 */
export async function saveSecureBrowserLogin(origin: string, account: string, secret: string): Promise<void> {
  const canonical = secureBrowserOrigin(origin)
  if (!account.trim() || !secret || account.length > 4096 || secret.length > MAX_CREDENTIAL) {
    throw new Error('Credenciales incompletas o demasiado largas.')
  }
  const path = vaultFile(canonical)
  await mkdir(vaultDirectory(), { recursive: true, mode: 0o700 })
  const tmp = path + '.' + process.pid + '.' + Date.now() + '.tmp'
  const record: VaultEntry = {
    Schema: 1, Origin: canonical, Account: await protect(account), Secret: await protect(secret),
  }
  try {
    await writeFile(tmp, JSON.stringify(record), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(tmp, path)
  } finally { await unlink(tmp).catch(() => undefined) }
}

/**
 * Decrypt on the trusted host only; never return this value via HTTP or tool output.
 * @param origin - Exact site origin.
 * @returns Current-user credential, or undefined when no entry exists.
 */
export async function resolveSecureBrowserLogin(origin: string): Promise<{ account: string; secret: string } | undefined> {
  const canonical = secureBrowserOrigin(origin)
  if (!browserVaultSupported() || !hasSecureBrowserLogin(canonical)) return undefined
  let entry: VaultEntry
  try { entry = JSON.parse(await readFile(vaultFile(canonical), 'utf8')) as VaultEntry }
  catch { throw new Error('El vault protegido no se pudo leer.') }
  if (entry.Schema !== 1 || entry.Origin !== canonical || typeof entry.Account !== 'string' || typeof entry.Secret !== 'string') {
    throw new Error('Los datos del vault no coinciden con el dominio solicitado.')
  }
  return { account: await unprotect(entry.Account), secret: await unprotect(entry.Secret) }
}

/**
 * Revoke one origin's protected login; does not read or reveal its contents.
 * @param origin - Exact origin selected by the human.
 * @returns Completion after the vault record is revoked.
 */
export async function forgetSecureBrowserLogin(origin: string): Promise<void> {
  await unlink(vaultFile(origin)).catch((error: unknown) => {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') {
      throw new Error('No se pudo eliminar el acceso protegido.')
    }
  })
}
