/** Relay the official CLI's OAuth challenge to the existing secure auth wizard. */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AuthorizationPrompt, AuthorizationNotice } from '@phoenix-ai/dsh-authorization'
import { LlmError } from '@phoenix-ai/dsh-llm'

interface LoginInteraction {
  signal: AbortSignal
  notify: (notice: AuthorizationNotice) => void
  prompt: (prompt: AuthorizationPrompt) => Promise<string>
}

/** Accept only complete Google OAuth consent links from the CLI, never arbitrary output. */
export function googleCliConsentUrl(output: string): string | undefined {
  const cleaned = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
  for (const match of cleaned.matchAll(/https:\/\/[^\s<>"']+(?=\s|$)/gu)) {
    try {
      const url = new URL(match[0])
      if (url.origin === 'https://accounts.google.com'
        && url.pathname.startsWith('/o/oauth2/')
        && url.searchParams.get('response_type') === 'code'
        && url.searchParams.get('redirect_uri') === 'https://antigravity.google/oauth-callback'
        && !url.username && !url.password) return url.href
    } catch { /* incomplete or untrusted link */ }
  }
  return undefined
}

/** Some CLI versions open the browser themselves and only print a code prompt. */
export function googleCliRequestsCode(output: string): boolean {
  const cleaned = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '').slice(-4096)
  return /(?:paste|enter|provide|input|type|pega|introduce|ingresa)[^\r\n]{0,120}(?:authorization|authentication|verification|oauth|auth|autorizaci[oó]n|verificaci[oó]n)?\s*(?:code|c[oó]digo)|(?:authorization|authentication|verification|oauth|auth)\s+code\s*:/iu.test(cleaned)
}

/** Keep stdin open until the code is submitted to this same login process. */
export function relayGoogleCliLogin(child: ChildProcessWithoutNullStreams, interaction: LoginInteraction): Promise<void> {
  return new Promise((resolve, reject) => {
    const promptAbort = new AbortController()
    let settled = false
    let prompted = false
    let submitted = false
    let output = ''
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      interaction.signal.removeEventListener('abort', cancelled)
      promptAbort.abort()
      output = ''
      if (error) {
        child.kill()
        reject(error)
      } else resolve()
    }
    const cancelled = (): void => finish(new LlmError('Autenticación de Antigravity cancelada.', 'ABORTED'))
    const deadline = setTimeout(() => finish(new LlmError('Tiempo agotado durante el acceso a Google. Vuelve a conectar la cuenta.', 'GOOGLE_CLI_LOGIN_TIMEOUT')), 10 * 60_000)
    deadline.unref()
    const receive = (chunk: string): void => {
      if (settled || prompted) return
      output = (output + chunk).slice(-64 * 1024)
      // Wait for a terminated URL so a split stdout chunk cannot truncate PKCE parameters.
      const url = googleCliConsentUrl(output.slice(0, Math.max(output.lastIndexOf('\n'), output.lastIndexOf('\r')) + 1))
      if (url === undefined && !googleCliRequestsCode(output)) return
      prompted = true
      output = ''
      interaction.notify({ message: 'Inicia sesión en Google. Copia el código que aparece en la página de Antigravity y pégalo aquí.', ...url === undefined ? {} : { url } })
      void interaction.prompt({
        kind: 'secret', message: 'Código de autorización de Google Antigravity',
        placeholder: 'Pega el código de Google aquí', signal: promptAbort.signal,
      }).then(answer => {
        if (settled) return
        const code = answer.trim()
        if (!code || code.length > 4096 || /[\r\n\u0000]/u.test(code)) {
          finish(new LlmError('El código de autorización no es válido. Inicia una nueva conexión.', 'AUTH_REQUIRED'))
          return
        }
        submitted = true
        child.stdin.end(code + '\n')
      }).catch(() => finish(new LlmError('No se completó la autorización de Google.', 'AUTH_REQUIRED')))
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', receive)
    child.stderr.on('data', receive)
    child.stdin.on('error', () => finish(new LlmError('No se pudo entregar el código a Antigravity CLI.', 'AUTH_REQUIRED')))
    child.on('error', () => finish(new LlmError('No se pudo iniciar Antigravity CLI para autenticar.', 'GOOGLE_CLI_LOGIN_FAILED')))
    child.on('close', code => {
      if (code === 0 && (!prompted || submitted)) finish()
      else finish(new LlmError('Antigravity no completó el inicio de sesión. Vuelve a conectar la cuenta.', 'AUTH_REQUIRED'))
    })
    interaction.signal.addEventListener('abort', cancelled, { once: true })
    if (interaction.signal.aborted) cancelled()
  })
}
