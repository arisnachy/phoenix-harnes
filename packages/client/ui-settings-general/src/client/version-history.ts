/** Public, bounded changelog parsing for PHOENIX's promoted stable branch. */
const COMMITS_URL = 'https://api.github.com/repos/arisnachy/phoenix-harnes/commits?sha=stable&per_page=100'
const PR_URL = 'https://api.github.com/repos/arisnachy/phoenix-harnes/pulls/'
const SHA = /^[0-9a-f]{40}$/iu

/** One first-parent-style release entry, with links derived from an allowlisted repository. */
export interface PhoenixVersionEntry {
  readonly sha: string
  readonly summary: string
  readonly publishedAt: string
  readonly prNumber?: number
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/**
 * Select only actual merge commits, not intermediate commits from PR branches.
 * The REST commits endpoint traverses all parents, so a naive list lies about releases.
 * @param payload - untrusted GitHub commits API payload.
 * @returns at most twelve validated, recent stable merge entries.
 */
export function parsePhoenixVersionHistory(payload: unknown): readonly PhoenixVersionEntry[] {
  if (!Array.isArray(payload)) return []
  const releases: PhoenixVersionEntry[] = []
  const seen = new Set<string>()
  for (const item of payload.slice(0, 100)) {
    const row = objectValue(item)
    const commit = objectValue(row?.commit)
    const author = objectValue(commit?.committer)
    const message = commit?.message
    const sha = row?.sha
    const parents = row?.parents
    if (typeof sha !== 'string' || !SHA.test(sha) || seen.has(sha)
      || !Array.isArray(parents) || parents.length < 2
      || typeof message !== 'string') continue
    const lines = message.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
    const pr = /^Merge (?:PR|pull request) #([0-9]{1,8})\b/iu.exec(lines[0] ?? '')
    // Avoid mistaking arbitrary merges on a PR branch for stable publications.
    if (pr === null) continue
    const date = author?.date
    if (typeof date !== 'string' || !Number.isFinite(Date.parse(date))) continue
    const prNumber = Number(pr[1])
    if (!Number.isSafeInteger(prNumber) || prNumber < 1) continue
    releases.push({
      sha,
      summary: (lines[1] ?? lines[0] ?? 'PHOENIX').slice(0, 200),
      publishedAt: date,
      prNumber,
    })
    seen.add(sha)
    if (releases.length >= 12) break
  }
  return releases
}

/**
 * Read published stable history, never infer the local installed SHA from this remote list.
 * @returns verified merge metadata; errors remain visible to the user.
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
 * Load human-readable change notes from the exact PR referenced by a published merge.
 * @param prNumber - integer validated against a promoted merge commit.
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
