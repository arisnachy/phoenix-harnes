// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  auditRenderedVisual,
  preflightVisualSpec,
  repairVisualSpec,
} from '../src/client/chat/visual-quality-gate.ts'

describe('visual quality gate', () => {
  it('rejects invalid candlestick contracts before render', () => {
    const result = preflightVisualSpec({
      visualType: 'chart',
      chartType: 'candlestick',
      candles: [
        { open: 100, high: 90, low: 80, close: 95 },
      ],
    })
    expect(result.valid).toBe(false)
    expect(result.issues).toContain('candlestick-row-0-invalid-ohlc')
  })

  it('repairs chart aliases and nested candle payloads deterministically', () => {
    const aliased = repairVisualSpec({
      visualType: 'chart',
      chartType: 'ohlc',
      data: { candles: [{ open: 10, high: 12, low: 9, close: 11 }] },
    }, 1)
    expect(aliased.changed).toBe(true)
    expect(aliased.spec.chartType).toBe('candlestick')

    const lifted = repairVisualSpec({
      visualType: 'chart',
      chartType: 'candlestick',
      data: { candles: [{ open: 10, high: 12, low: 9, close: 11 }] },
    }, 1)
    expect(lifted.changed).toBe(true)
    expect(Array.isArray(lifted.spec.candles)).toBe(true)
    expect(preflightVisualSpec(lifted.spec).valid).toBe(true)
  })

  it('fails a raw JSON fallback instead of counting it as a rendered visual', () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre data-phoenix-visual-fallback="true">{}</pre>'
    const report = auditRenderedVisual(root, {
      visualType: 'chart',
      chartType: 'bar',
      data: [{ label: 'A', value: 1 }],
    }, 2)
    expect(report.verdict).toBe('fail')
    expect(report.fallbackUsed).toBe(true)
    expect(report.issues).toContain('renderer-fallback-used')
    expect(report.needsVisionReview).toBe(true)
  })

  it('passes a rendered chart only when expected marks are actually present', () => {
    const root = document.createElement('div')
    root.innerHTML = [
      '<section data-phoenix-visual-kind="chart" data-phoenix-chart-type="line" data-phoenix-expected-marks="2">',
      '<svg><text>Jan</text>',
      '<circle data-phoenix-visual-mark="line-point" cx="10" cy="10" r="4"></circle>',
      '<circle data-phoenix-visual-mark="line-point" cx="20" cy="20" r="4"></circle>',
      '</svg></section>',
    ].join('')
    const report = auditRenderedVisual(root, {
      visualType: 'chart',
      chartType: 'line',
      data: [{ label: 'Jan', value: 1 }, { label: 'Feb', value: 2 }],
    }, 0)
    expect(report.verdict).toBe('pass')
    expect(report.expectedMarks).toBe(2)
    expect(report.renderedMarks).toBe(2)
    expect(report.invalidCoordinates).toBe(0)
  })
})
