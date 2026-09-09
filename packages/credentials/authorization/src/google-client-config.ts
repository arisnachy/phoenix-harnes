import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const GOOGLE_OAUTH_CLIENT_FILENAME = 'google-oauth-client.json'

export interface GoogleOAuthClientIdResolutionOptions {
  /** Override the PHOENIX/DSH home. Primarily useful for tests and portable installs. */
  dshHome?: string
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function defaultDshHome(): string {
  const configured = process.env.DSH_HOME
  return nonEmpty(configured) ? resolve(configured.trim()) : resolve(homedir(), '.dsh')
}

/**
 * Resolve the Google OAuth deployment identity without exposing OAuth secrets.
 *
 * PHOENIX first reuses a Google client configuration already provisioned in
 * `<dsh-home>/secrets/google-oauth-client.json`. Only `client_id` is retained;
 * `client_secret` and every other field are ignored. When the file is absent,
 * the caller-provided client id remains a backwards-compatible fallback.
 *
 * A present but malformed file fails loud instead of silently falling back: an
 * operator who intentionally provisioned local OAuth configuration should not
 * unknowingly authenticate as a different deployment identity.
 */
export function resolveGoogleOAuthClientId(
  fallbackClientId?: string,
  options: GoogleOAuthClientIdResolutionOptions = {},
): string | undefined {
  const dshHome = options.dshHome === undefined ? defaultDshHome() : resolve(options.dshHome)
  const filename = resolve(dshHome, 'secrets', GOOGLE_OAUTH_CLIENT_FILENAME)

  let content: string
  try {
    content = readFileSync(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      return nonEmpty(fallbackClientId) ? fallbackClientId.trim() : undefined
    }
    throw new TypeError(`authorization-google: failed to read local Google OAuth client configuration ${filename}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content) as unknown
  } catch {
    throw new TypeError(`authorization-google: failed to parse local Google OAuth client configuration ${filename}`)
  }

  const root = record(parsed)
  const installed = record(root?.installed)
  const web = record(root?.web)
  const localClientId = nonEmpty(installed?.client_id)
    ? installed.client_id.trim()
    : nonEmpty(web?.client_id)
      ? web.client_id.trim()
      : undefined

  if (localClientId === undefined) {
    throw new TypeError(`authorization-google: local Google OAuth client configuration ${filename} does not contain a usable client_id`)
  }
  return localClientId
}
