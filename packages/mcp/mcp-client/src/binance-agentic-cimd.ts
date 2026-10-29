/**
 * Public PHOENIX client identity for the official Binance Agentic MCP.
 *
 * Binance's OAuth authorization server advertises CIMD and does not offer
 * Dynamic Client Registration. The JSON document is published from PHOENIX's
 * public repository via a stable HTTPS JSON CDN; it contains no credentials.
 * Never substitute another AI vendor's (Codex/Claude) OAuth client id.
 */
export const PHOENIX_BINANCE_AGENTIC_CIMD_ID =
  'https://cdn.jsdelivr.net/gh/arisnachy/phoenix-harnes@main/website/public/oauth/binance-agentic-client.json'

/** Only the exact pinned official server gets the CIMD identity. */
export function binanceAgenticCimdClientId(config: {
  readonly transport: string
  readonly serverName: string
  readonly url: string
  readonly oauth?: boolean
  readonly oauthClientIdRef?: string
  readonly oauthClientSecretRef?: string
}): string | undefined {
  if (config.transport !== 'streamable-http'
    || config.serverName !== 'binance-agent-os'
    || config.url !== 'https://agent.binance.com/mcp/agentic'
    || config.oauth === false || config.oauthClientIdRef !== undefined
    || config.oauthClientSecretRef !== undefined) return undefined
  return PHOENIX_BINANCE_AGENTIC_CIMD_ID
}
