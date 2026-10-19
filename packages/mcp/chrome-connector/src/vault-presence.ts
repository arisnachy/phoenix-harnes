/**
 * Model-safe, read-only credential metadata for the ACTUAL selected browser tab.
 * Credentials, account identifiers, cookies and DPAPI blobs never leave Vault.
 * Unknown != missing: a failed host query cannot justify prompting for secrets.
 */
export type BrowserVaultPresence =
  | { known: false; reason: 'vault-unavailable' | 'no-web-origin' }
  | { known: true; saved: boolean; automatic: boolean; relatedSaved: boolean; relatedOrigin?: string }
export async function inspectVaultPresence(
  pageUrl: string,
  query: typeof fetch = fetch,
  localPort = process.env.PHOENIX_WEB_PORT ?? process.env.DSH_WEB_PORT ?? '3080',
): Promise<BrowserVaultPresence> {
  let origin: string
  try {
    const parsed = new URL(pageUrl)
    if (parsed.protocol !== 'https:'
      && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
      return { known: false, reason: 'no-web-origin' }
    }
    origin = parsed.origin
  } catch { return { known: false, reason: 'no-web-origin' } }
  if (!/^[0-9]{1,5}$/.test(localPort) || +localPort < 1 || +localPort > 65535) {
    return { known: false, reason: 'vault-unavailable' }
  }
  try {
    // Never accept an agent-provided Vault hostname/port or a requested
    // origin: both must derive from this process and the selected CDP tab.
    const response = await query(
      'http://127.0.0.1:' + localPort
        + '/phoenix-secure-login/status?origin=' + encodeURIComponent(origin),
      { headers: { 'x-phoenix-secure-login': '1' }, signal: AbortSignal.timeout(1_600) },
    )
    if (!response.ok) return { known: false, reason: 'vault-unavailable' }
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object' || !('saved' in data)
      || typeof data.saved !== 'boolean' || !('automatic' in data)
      || typeof data.automatic !== 'boolean') {
      return { known: false, reason: 'vault-unavailable' }
    }
    const row = data as { saved: boolean; automatic: boolean; relatedSaved?: boolean; relatedOrigin?: string }
    return {
      known: true, saved: row.saved, automatic: row.automatic,
      relatedSaved: row.relatedSaved === true,
      ...(row.relatedSaved && row.relatedOrigin
        ? { relatedOrigin: row.relatedOrigin } : {}),
    }
  } catch { return { known: false, reason: 'vault-unavailable' } }
}
