/** Windows-only current-user DPAPI encryption for origin-scoped website logins.
 * No password is passed via process argv, environment variables, logs or model context.
 * If DPAPI is unavailable, writes fail closed rather than persisting plaintext.
 */
import { execFile } from 'node:child_process'

const CIPHER_PREFIX = 'win-dpapi-v1:'
const ORIGIN_REF = /^PHOENIX_WEB_[0-9A-F]+_(?:ACCOUNT|SECRET)$/u

/** Select only the two protected origin-login fields; leave existing API credentials intact. */
export function isProtectedWebLoginRef(ref: string): boolean {
  return ORIGIN_REF.test(ref)
}

/** Fixed PowerShell program: script travels as encoded constant argv; input travels on stdin. */
const PROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
$plain = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($plain)
try {
  $output = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  try { [Console]::Out.Write([Convert]::ToBase64String($output)) }
  finally { [Array]::Clear($output, 0, $output.Length) }
} finally { [Array]::Clear($bytes, 0, $bytes.Length) }
`
const UNPROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
$encoded = [Console]::In.ReadToEnd()
$bytes = [Convert]::FromBase64String($encoded)
try {
  $output = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  try { [Console]::Out.Write([Text.Encoding]::UTF8.GetString($output)) }
  finally { [Array]::Clear($output, 0, $output.Length) }
} finally { [Array]::Clear($bytes, 0, $bytes.Length) }
`

/** Run fixed DPAPI code without putting a secret in argv, temp files or error text. */
function invokeDpapi(script: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = execFile('powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 128 * 1024 },
      (error, stdout) => {
        if (error !== null || stdout.length === 0) {
          reject(new Error('Windows credential protection is unavailable for this account. Nothing was saved.'))
          return
        }
        resolve(stdout.trim())
      })
    if (child.stdin === null) {
      child.kill()
      reject(new Error('Windows credential protection cannot open its private input. Nothing was saved.'))
      return
    }
    child.stdin.on('error', () => { /* failed write is also handled by the process callback */ })
    child.stdin.end(input, 'utf8')
  })
}

/** Encrypt an origin login for this Windows user; non-Windows deployments retain POSIX owner-only storage. */
export async function protectWebLoginAtRest(ref: string, value: string): Promise<string> {
  if (!isProtectedWebLoginRef(ref) || process.platform !== 'win32') return value
  const ciphertext = await invokeDpapi(PROTECT_SCRIPT, value)
  return CIPHER_PREFIX + ciphertext
}

/** Read one origin login. Reject foreign/malformed DPAPI ciphertext without exposing it. */
export async function unprotectWebLoginAtRest(ref: string, value: string): Promise<string> {
  if (!isProtectedWebLoginRef(ref)) return value
  if (!value.startsWith(CIPHER_PREFIX)) return value // legacy plaintext: caller must migrate
  if (process.platform !== 'win32') throw new Error('This protected website login requires its original Windows user.')
  return await invokeDpapi(UNPROTECT_SCRIPT, value.slice(CIPHER_PREFIX.length))
}

/** Identify the legacy value that needs one safe write-through upgrade before use on Windows. */
export function webLoginNeedsProtection(ref: string, stored: string): boolean {
  return process.platform === 'win32' && isProtectedWebLoginRef(ref) && !stored.startsWith(CIPHER_PREFIX)
}
