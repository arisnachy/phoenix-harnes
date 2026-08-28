import { describe, expect, it } from 'vitest'
import { registerArtifactRenderer, renderArtifactBlock, validateUniversalArtifact } from '../src/client/universal-artifacts.ts'

describe('HARDNESS universal artifacts', () => {
  it('accepts mixed blocks for code, media, data, documents and apps', () => {
    const artifact = {
      id: 'mlb-crypto-1', title: 'Universal result', status: 'verified', version: '1', evidence: [],
      blocks: [
        { type: 'markdown', text: 'Resumen' },
        { type: 'code', language: 'python', text: 'print(42)', filename: 'analysis.py' },
        { type: 'image', src: 'https://example.com/chart.png', alt: 'Chart' },
        { type: 'table', columns: ['team', 'wins'], rows: [['Yankees', '90']] },
        { type: 'chart', spec: { mark: 'line', data: [1, 2, 3] } },
        { type: 'candles', symbol: 'BTCUSD', interval: '1h', points: [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }] },
        { type: 'map', spec: { center: [0, 0] } },
        { type: 'document', mime: 'text/markdown', text: '# doc' },
        { type: 'file', filename: 'data.json', mime: 'application/json', text: '{}' },
        { type: 'app', entry: 'index.html', files: { 'index.html': '<h1>safe</h1>' } },
      ],
    } as const
    expect(validateUniversalArtifact(artifact)).toBe(true)
    expect(artifact.blocks.map(renderArtifactBlock)).toHaveLength(10)
  })

  it('supports future block types through the renderer registry and safe fallback', () => {
    const block = { type: 'audio-waveform', mime: 'audio/wav', data: { peaks: [0, 1, 0] } } as const
    expect(validateUniversalArtifact({ id: 'x', title: 'x', status: 'testing', blocks: [block], evidence: [] })).toBe(true)
    expect(JSON.stringify(renderArtifactBlock(block))).toContain('audio-waveform')
    const dispose = registerArtifactRenderer('audio-waveform', value => ({ type: 'custom-waveform', props: { value } }) as never)
    expect((renderArtifactBlock(block) as { type: string }).type).toBe('custom-waveform')
    dispose()
    expect(JSON.stringify(renderArtifactBlock(block))).toContain('peaks')
  })

  it('rejects executable URLs, handlers and malformed OHLC data', () => {
    expect(validateUniversalArtifact({ id: 'x', title: 'x', status: 'verified', blocks: [{ type: 'image', src: 'javascript:alert(1)', alt: 'x' }], evidence: [] })).toBe(false)
    expect(validateUniversalArtifact({ id: 'x', title: 'x', status: 'verified', blocks: [{ type: 'candles', symbol: 'X', interval: '1m', points: [{ time: 1, open: 2, high: 1, low: 0, close: 1 }] }], evidence: [] })).toBe(false)
  })
})
