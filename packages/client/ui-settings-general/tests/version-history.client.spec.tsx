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
  it('lists only promoted merge commits and never treats intermediate PR commits as releases', () => {
    expect(parsePhoenixVersionHistory([release, intermediate])).toEqual([{
      sha: publishedSha,
      summary: 'feat(profile): coherencia del avatar y fotografía original',
      publishedAt: '2026-10-31T16:05:37Z',
      prNumber: 1271,
    }])
    const githubMerge = {
      ...release,
      sha: 'f'.repeat(40),
      commit: {
        message: 'Merge pull request #1256 from arisnachy/feature/the-odds-api-key-connector-20261030\n\nfeat(connectors): Secure The Odds API v4 key setup',
        committer: { date: '2026-10-31T16:10:11Z' },
      },
    }
    expect(parsePhoenixVersionHistory([githubMerge])[0]).toMatchObject({
      sha: 'f'.repeat(40),
      prNumber: 1256,
      summary: 'feat(connectors): Secure The Odds API v4 key setup',
    })

    expect(parsePhoenixVersionHistory('not an API array')).toEqual([])
    expect(parsePhoenixVersionHistory([{
      ...release,
      sha: '../malicious',
    }])).toEqual([])
    expect(parsePhoenixVersionHistory([{
      ...release,
      commit: { ...release.commit, message: 'Merge PR #0: invalid' },
    }])).toEqual([])
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
    expect((await screen.findByTestId('installed-sha')).textContent).toContain('aaaaaaaaaaaa')
    await waitFor(() => { expect(screen.getAllByText('bbbbbbbbbbbb').length).toBeGreaterThan(0) })
    expect(screen.getByText('cccccccccccc')).toBeTruthy()
    expect(await screen.findByText('feat(profile): coherencia del avatar y fotografía original')).toBeTruthy()
    expect(screen.getByText(/Differs from verified local version/u)).toBeTruthy()
    expect(screen.queryByText('fix(profile): work in progress')).toBeNull()
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
