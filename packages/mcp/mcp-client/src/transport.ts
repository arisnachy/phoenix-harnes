/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL.
 *
 * @module
 */

import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './index.ts'
import { rejectRedirectFetch } from './oauth.ts'

/** OAuth provider ownership is keyed to the resolved config object, never serialized into config. */
const managedOAuthProviders = new WeakMap<object, OAuthClientProvider>()

/**
 * Bind a Host-only OAuth provider to one live resolved config object.
 * @returns disposer that removes the binding iff it still belongs to this provider.
 */
export function bindManagedOAuthProvider(config: Config, provider: OAuthClientProvider): () => void {
  managedOAuthProviders.set(config, provider)
  return () => {
    if (managedOAuthProviders.get(config) === provider) managedOAuthProviders.delete(config)
  }
}

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

/**
 * Remote MCP endpoints must use TLS. Plain HTTP is accepted only for a local
 * loopback endpoint used by an explicitly local server; credentials in the URL
 * are never accepted.
 */
export function validateHttpEndpoint(raw: string): URL {
  let url: URL
  try { url = new URL(raw) } catch (error: unknown) { throw new Error(`mcp-client: invalid HTTP endpoint URL: ${raw}`, { cause: error }) }
  if (url.username || url.password) throw new Error('mcp-client: credentials in MCP endpoint URLs are not allowed')
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('mcp-client: streamable-http endpoints must use https, except loopback http fixtures')
  }
  return url
}

/** Config headers may not smuggle a second bearer credential beside the managed OAuth provider. */
function assertNoConfiguredAuthorizationHeader(headers: Record<string, string>): void {
  if (Object.keys(headers).some(name => name.toLowerCase() === 'authorization')) {
    throw new Error('mcp-client: config.headers.Authorization is not allowed when managed OAuth is enabled')
  }
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @param explicitAuthProvider - Optional provider override used by focused tests.
 * @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
 */
export function createTransport(config: Config, explicitAuthProvider?: OAuthClientProvider): Transport {
  const authProvider = explicitAuthProvider ?? managedOAuthProviders.get(config)
  switch (config.transport) {
    case 'stdio':
      if (authProvider !== undefined) throw new Error('mcp-client: managed OAuth is only available for streamable-http')
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
      })
    case 'streamable-http': {
      if (authProvider !== undefined) assertNoConfiguredAuthorizationHeader(config.headers)
      const options = authProvider === undefined
        ? { requestInit: { headers: config.headers } }
        : {
            requestInit: { headers: config.headers },
            authProvider,
            // Credential-bearing provider and resource requests fail on every
            // redirect rather than forwarding Authorization/client-secret data.
            fetch: rejectRedirectFetch,
          }
      // The MCP SDK's StreamableHTTPClientTransport has optional callback
      // properties typed without `| undefined` (exactOptionalPropertyTypes
      // mismatch with the Transport interface); the SDK constructed the
      // object, so the cast records only that widening.
      return new StreamableHTTPClientTransport(validateHttpEndpoint(config.url), options) as Transport
    }
  }
}
