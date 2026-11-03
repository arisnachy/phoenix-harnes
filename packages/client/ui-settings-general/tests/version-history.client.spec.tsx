// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { VersionHistorySection } from '../src/client/VersionHistorySection.tsx'
import { parsePhoenixVersionHistory } from '../src/client/version-history.ts'

const installedSha = 'a'.repeat(40)
const publishedSha = 'b'.repeat(40)
const oldSha = 'c'.repeat(40)
const release = {
  sha: publishedSha,
  parents: [{ sha: oldSha }, { sha: 'd'.repeat(40) }],
  commit: {
    message: 'Merge PR #1271: avatar Kira, original photo and opt-in reference\n\nfeat(profile): coherencia del avatar y fotografía original',
    committer: { date: '2026-10-31T16:05:37Z' },
  },
}
const intermediate = {
  sha: oldSha,
  parents: [{ sha: 'e'.repeat(40) }],
  commit: { message: 'fix(profile): work in progress', committer: { date: '2026-10-31T15:59:00Z' } },
}
const t = ((key: string) => (en as Record<string, string>)[key] ?? key) as never
const kit = { useSessions: (() => { throw new Error('not needed') }) as never,
  useWorkspaces: (() => { throw new Error('not needed') }) as never }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('published PHOENIX versions', () => {
  it('lists verified stable commits even when squash or direct commits have one parent', () => {
    expect(parsePhoenixVersionHistory([release, intermediate])).toEqual([
      {
        sha: publishedSha,
        summary: 'feat(profile): coherencia del avatar y fotografía original',
        publishedAt: '2026-10-31T16:05:37Z',
        prNumber: 1271,
        notes: 'feat(profile): coherencia del avatar y fotografía original',
      },
      {
        sha: oldSha,
        summary: 'fix(profile): work in progress',
        publishedAt: '2026-10-31T15:59:00Z',
      },
    ])
    const githubMerge = {
      ...release,
      sha: 'f'.repeat(40),
      commit: {
        message: 'Merge pull request #1256 from arisnachy/feature/the-odds-api-key-connector-20261030\\n\\nfeat(connectors): Secure The Odds API v4 key setup',
        committer: { date: '2026-10-31T16:10:11Z' },
      },
    }
    expect(parsePhoenixVersionHistory([githubMerge])[0]).toMatchObject({
      sha: 'f'.repeat(40),
      prNumber: 1256,
      summary: 'feat(connectors): Secure The Odds API v4 key setup',
    })
  })

  it('recognizes stable cherry-picks, squash titles and release details without fabricated PRs', () => {
    const squash = {
      sha: 'e'.repeat(40), parents: [{ sha: 'a'.repeat(40) }],
      commit: {
        message: 'fix(connectors): curated remote type on stable (#1337)\\n\\nVerified setup and persistence.',
        committer: { date: '2026-11-03T02:16:00Z' },
      },
    }
    const direct = {
      sha: 'd'.repeat(40), parents: [{ sha: 'b'.repeat(40) }],
      commit: {
        message: 'feat(assurance): operational verification\\n\\nDocumented exact acceptance criteria.',
        committer: { date: '2026-11-03T02:46:00Z' },
      },
    }
    expect(parsePhoenixVersionHistory([direct, squash])).toEqual([
      { sha: direct.sha, summary: 'feat(assurance): operational verification',
        publishedAt: '2026-11-03T02:46:00Z', notes: 'Documented exact acceptance criteria.' },
      { sha: squash.sha, summary: 'fix(connectors): curated remote type on stable (#1337)',
        publishedAt: '2026-11-03T02:16:00Z', notes: 'Verified setup and persistence.', prNumber: 1337 },
    ])
    expect(parsePhoenixVersionHistory([direct, direct, squash])).toHaveLength(2)
    expect(parsePhoenixVersionHistory(Array.from({ length: 30 }, (_, i) => ({
      ...direct, sha: i.toString(16).padStart(40, '0'),
    })))).toHaveLength(12)
  })

  it('rejects forged or malformed records without discarding valid single-parent releases', () => {
    expect(parsePhoenixVersionHistory('not an API array')).toEqual([])
    expect(parsePhoenixVersionHistory([{ ...release, sha: '../malicious' }])).toEqual([])
    expect(parsePhoenixVersionHistory([{ ...release, parents: [] }])).toEqual([])
    expect(parsePhoenixVersionHistory([{ ...release,
      commit: { ...release.commit, committer: { date: 'invalid' } } }])).toEqual([])
    expect(parsePhoenixVersionHistory([{
      ...release, commit: { ...release.commit, message: 'Merge PR #0: invalid' },
    }])[0]).not.toHaveProperty('prNumber')
    expect(parsePhoenixVersionHistory([{
      ...release, commit: {
        message: 'fix(profile): native profile history',
        author: { date: '2026-10-31T16:05:37Z' },
      },
    }])).toHaveLength(1)
  })

  it('distinguishes the active local version, candidate, previous version and published stable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [release, intermediate],
    })
    vi.stubGlobal('fetch', fetchMock)
    const readUpdateState = vi.fn().mockResolvedValue({
      status: 'preparing',
      phase: 'build',
      current: installedSha,
      target: publishedSha,
      previous: oldSha,
    })
    render(<VersionHistorySection {...kit} t={t} readUpdateState={readUpdateState} close={vi.fn()} />)
    await waitFor(() => { expect(screen.getByTestId('installed-sha').textContent).toContain('aaaaaaaaaaaa') })
    await waitFor(() => { expect(screen.getAllByText('bbbbbbbbbbbb').length).toBeGreaterThan(0) })
    expect(screen.getByText('cccccccccccc')).toBeTruthy()
    expect(await screen.findByText('feat(profile): coherencia del avatar y fotografía original')).toBeTruthy()
    expect(screen.getByText(/Differs from verified local version/u)).toBeTruthy()
    expect(screen.getByText('fix(profile): work in progress')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/arisnachy/phoenix-harnes/commits?sha=stable&per_page=100',
      { headers: { Accept: 'application/vnd.github+json' } },
    )
  })

  it('shows real PR change notes on demand without executing markup', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [release] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        body: 'Avatar proportions improved. <script>alert(1)</script>',
      }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<VersionHistorySection
      {...kit}
      t={t}
      close={vi.fn()}
      readUpdateState={async () => ({ status: 'current', current: publishedSha })}
    />)
    expect(await screen.findByText('feat(profile): coherencia del avatar y fotografía original')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'What changed' }))
    expect(await screen.findByText(/Avatar proportions improved/)).toBeTruthy()
    expect(document.querySelector('script')).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/arisnachy/phoenix-harnes/pulls/1271',
      { headers: { Accept: 'application/vnd.github+json' } },
    )
  })

  it('shows stable direct commit details without pretending an origin PR exists', async () => {
    const direct = {
      sha: '9'.repeat(40),
      parents: [{ sha: '8'.repeat(40) }],
      commit: {
        message: 'feat(assurance): operational verification\\n\\nIncludes reproducible run instructions.',
        committer: { date: '2026-11-03T02:46:00Z' },
      },
    }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [direct] })
    vi.stubGlobal('fetch', fetchMock)
    render(<VersionHistorySection {...kit} t={t} close={vi.fn()}
      readUpdateState={async () => ({ status: 'current', current: installedSha })} />)
    expect(await screen.findByText('feat(assurance): operational verification')).toBeTruthy()
    expect(screen.queryByText('PR #1337')).toBeNull()
    expect(screen.getByRole('link', { name: 'View commit' }).getAttribute('href'))
      .toBe('https://github.com/arisnachy/phoenix-harnes/commit/' + direct.sha)
    fireEvent.click(screen.getByRole('button', { name: 'What changed' }))
    expect(await screen.findByText('Includes reproducible run instructions.')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the stable commit body when GitHub PR details are unavailable', async () => {
    const source = {
      ...release,
      commit: { ...release.commit, message: 'fix(chat): safe format (#1333)\\n\\nCurrency delimiters cannot swallow prose.' },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [source] })
      .mockResolvedValueOnce({ ok: false, status: 403 })
    vi.stubGlobal('fetch', fetchMock)
    render(<VersionHistorySection {...kit} t={t} close={vi.fn()}
      readUpdateState={async () => ({ status: 'current', current: installedSha })} />)
    expect(await screen.findByText('fix(chat): safe format (#1333)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'What changed' }))
    expect(await screen.findByText('Currency delimiters cannot swallow prose.')).toBeTruthy()
  })

  it('does not mistake a published GitHub SHA for a verified installation when Host is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [release],
    }))
    render(<VersionHistorySection
      {...kit}
      t={t}
      close={vi.fn()}
      readUpdateState={async () => { throw new Error('offline host') }}
    />)
    expect((await screen.findByRole('alert')).textContent).toContain('Cannot contact the Host')
    expect(screen.getByTestId('installed-sha').textContent).toContain('Not verified')
    expect(await screen.findByText('feat(profile): coherencia del avatar y fotografía original')).toBeTruthy()
  })
})
