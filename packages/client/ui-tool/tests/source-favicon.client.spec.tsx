// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { RunningToolCall, ToolResultNode } from '@phoenix-ai/dsh-client-runtime/client'
import { SourceFavicon, faviconOrigin, sourceFaviconOrigin } from '../src/client/tool/components/SourceFavicon.tsx'

afterEach(cleanup)
const running = (name: string, argsRaw: string): RunningToolCall => ({
  callId: 'favicon-1', name, argsRaw, turn: 1, step: 1, time: 1000, callView: null, subCalls: [],
})
describe('compact source favicons', () => {
  it('accepts only observed HTTPS sources and never exposes secret arguments', () => {
    expect(faviconOrigin('https://www.espn.com/nba?token=secret')).toBe('https://www.espn.com')
    expect(faviconOrigin('https://user:password@espn.com')).toBeUndefined()
    expect(faviconOrigin('http://espn.com')).toBeUndefined()
    expect(faviconOrigin('https://127.0.0.1')).toBeUndefined()
    expect(faviconOrigin('https://server.internal')).toBeUndefined()
    expect(sourceFaviconOrigin(running('web_search', '{"query":"ESPN NBA"}'))).toBeUndefined()
    expect(sourceFaviconOrigin(running('web_fetch', '{"url":"https://www.espn.com/nba"}'))).toBe('https://www.espn.com')
  })
  it('uses actual search results, named connector services, and nested Code tools', () => {
    const result: ToolResultNode = {
      kind: 'tool-result', seq: 2, time: 2000, callId: 'favicon-2',
      call: { name: 'web_search', argsRaw: '{"query":"NHL"}' }, callTime: 1000, content: [],
      isError: false, callView: null, resultView: {
        card: 'web', kind: 'search', answer: '', truncated: false,
        sources: [{ url: 'https://www.nhl.com/news', title: 'NHL', snippet: '' }],
      }, subCalls: [],
    }
    expect(sourceFaviconOrigin(result)).toBe('https://www.nhl.com')
    expect(sourceFaviconOrigin(running('mcp__GitHub__fetch', '{}'))).toBe('https://github.com')
    expect(sourceFaviconOrigin({ ...running('Code', '{}'), subCalls: [
      running('web_fetch', '{"url":"https://www.mlb.com/news"}'),
    ] })).toBe('https://www.mlb.com')
  })
  it('keeps the 14px dimensions and restores the old icon after both image failures', () => {
    const view = render(<SourceFavicon block={running('web_fetch', '{"url":"https://www.nba.com/schedule"}')}
      fallback={<span data-testid="old-icon">tool</span>} />)
    const img = view.container.querySelector('img')
    expect(img?.getAttribute('width')).toBe('14')
    expect(img?.getAttribute('src')).toBe('https://www.nba.com/favicon.ico')
    if (img === null) throw new Error('Missing favicon')
    fireEvent.error(img)
    const retry = view.container.querySelector('img')
    expect(retry?.getAttribute('src')).toContain('google.com/s2/favicons')
    if (retry === null) throw new Error('Missing fallback favicon')
    fireEvent.error(retry)
    expect(view.getByTestId('old-icon')).toBeTruthy()
  })
})
