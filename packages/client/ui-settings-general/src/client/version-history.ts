/** Public, bounded changelog parsing for PHOENIX's promoted stable branch. */
const COMMITS_URL = 'https://api.github.com/repos/arisnachy/phoenix-harnes/commits?sha=stable&per_page=100'
const PR_URL = 'https://api.github.com/repos/arisnachy/phoenix-harnes/pulls/'
const SHA = /^[0-9a-f]{40}$/iu

/** One verified commit reachable from the stable branch; PR links are optional. */
export interface PhoenixVersionEntry {
  readonly sha: string
  readonly summary: string
  readonly publishedAt: string
  readonly prNumber?: number
  readonly notes?: string
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/**
 * The stable commits REST endpoint already scopes commits to stable history.
 * PHOENIX publishes with squash, cherry-pick and single-parent commits, so
 * requiring a two-parent `Merge PR #...` silently discarded every new release.
 * Validate the commit metadata instead, including the exact stable commit SHA.
 * @param payload - Untrusted GitHub commits API response for sha=stable.
 * @returns Up to 12 verified stable commits with optional PR provenance.
 */
export function parsePhoenixVersionHistory(payload: unknown): readonly PhoenixVersionEntry[] {
  if (!Array.isArray(payload)) return []
  const releases: PhoenixVersionEntry[] = []
  const seen = new Set<string>()
  for (const item of payload.slice(0, 100)) {
    const row = objectValue(item)
    const commit = objectValue(row?.commit)
    const committer = objectValue(commit?.committer)
    const author = objectValue(commit?.author)
    const sha = row?.sha
    const message = commit?.message
    if (typeof sha !== 'string' || !SHA.test(sha) || seen.has(sha)
      || !Array.isArray(row?.parents) || row.parents.length === 0
      || typeof message !== 'string' || message.trim().length === 0) continue
    const date = committer?.date ?? author?.date
    if (typeof date !== 'string' || !Number.isFinite(Date.parse(date))) continue
    const lines = message.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
    const headline = lines[0]
    if (headline === undefined) continue
    // Both historical merge messages and modern squash/cherry-picked PR titles.
    const mergePr = /^Merge (?:PR|pull request) #([0-9]{1,8})\b/iu.exec(headline)
    const titledPr = /\(#([0-9]{1,8})\)\s*$/u.exec(headline)
    const number = mergePr?.[1] ?? titledPr?.[1]
    const parsed = number === undefined ? undefined : Number(number)
    const prNumber = parsed !== undefined && Number.isSafeInteger(parsed) && parsed >= 1
      ? parsed : undefined
    const summary = (mergePr === null ? headline : (lines[1] ?? headline)).slice(0, 200)
    const body = lines.slice(1).join('\n').slice(0, 3600)
    releases.push({
      sha,
      summary,
      publishedAt: date,
      ...(prNumber === undefined ? {} : { prNumber }),
      ...(body.length === 0 ? {} : { notes: body }),
    })
    seen.add(sha)
    if (releases.length >= 12) break
  }
  return releases
}

/**
 * Read published stable history, never infer the local installed SHA from this remote list.
 * @returns validated stable commit history; network and schema errors stay visible.
 */
export async function fetchPhoenixVersionHistory(): Promise<readonly PhoenixVersionEntry[]> {
  const response = await fetch(COMMITS_URL, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error('Stable release history is unavailable')
  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) throw new Error('Unexpected stable release history')
  return parsePhoenixVersionHistory(payload)
}

/**
 * Load human-readable change notes from a PR number embedded in a stable commit.
 * @param prNumber - integer extracted and validated from a stable commit title.
 * @returns a bounded plain-text description, or undefined if not supplied.
 */
export async function fetchPhoenixReleaseNotes(prNumber: number): Promise<string | undefined> {
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0 || prNumber > 99_999_999) return undefined
  const response = await fetch(PR_URL + String(prNumber), {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error('Release notes are unavailable')
  const payload: unknown = await response.json()
  const row = objectValue(payload)
  if (row === undefined) throw new Error('Unexpected release notes')
  const body = row.body
  return typeof body === 'string' && body.trim().length > 0 ? body.trim().slice(0, 3600) : undefined
}
