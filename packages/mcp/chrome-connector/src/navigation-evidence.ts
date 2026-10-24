/**
 * Conservative CDP receipt for opening a page in one conversation's browser.
 * A created target or Page.navigate acknowledgement is never page-load proof.
 */
export interface NavigationEvidence {
  /** URL reported by the page itself, not the requested address. */
  readonly url: string
  readonly readyState: string
  readonly title: string
  readonly visibleTextLength: number
  readonly contentElements: number
}
/** Evidence-based result of a browser navigation attempt. */
export type NavigationVerdict = 'verified' | 'redirected' | 'empty' | 'loading'

/**
 * Evaluate real navigation evidence without treating a blank page as success.
 * @param requestedUrl - HTTP(S) address Kira attempted to open.
 * @param evidence - CDP DOM snapshot of the target tab.
 * @returns Verified, redirected, empty, or still loading.
 */
export function classifyNavigationEvidence(requestedUrl: string, evidence: NavigationEvidence | undefined): NavigationVerdict {
  if (evidence === undefined) return 'loading'
  let actual: URL
  let requested: URL
  try {
    actual = new URL(evidence.url)
    requested = new URL(requestedUrl)
  } catch { return 'loading' }
  if (!['http:', 'https:'].includes(actual.protocol)) return 'loading'
  if (evidence.readyState === 'loading') return 'loading'
  const meaningful = evidence.visibleTextLength > 0 || evidence.contentElements > 0
  if (!meaningful) return 'empty'
  const stripWww = (host: string): string => host.replace(/^www\./iu, '')
  if (stripWww(actual.hostname) !== stripWww(requested.hostname)) return 'redirected'
  const path = (url: URL): string => url.pathname.length > 1 && url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
  if (path(actual) !== path(requested)) return 'redirected'
  for (const [key, value] of requested.searchParams) {
    if (actual.searchParams.get(key) !== value) return 'redirected'
  }
  return 'verified'
}
