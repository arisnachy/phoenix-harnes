import { describe, expect, it, vi } from 'vitest'
import { createWorldBankHealthSeriesTool, fetchWorldBankHealthSeries } from '../src/health-series.ts'

describe('Official World Bank health indicator series', () => {
  it('keeps missing years explicit, returns original units, and reports source URI', async () => {
    const request = vi.fn(async (value: string | URL) => {
      const url = new URL(String(value))
      expect(url.origin).toBe('https://api.worldbank.org')
      expect(url.pathname).toBe('/v2/country/DOM/indicator/SP.DYN.IMRT.IN')
      expect(url.searchParams.get('date')).toBe('2023:2025')
      return new Response(JSON.stringify([
        { page: 1, pages: 1, total: 3 },
        [
          { indicator: { id: 'SP.DYN.IMRT.IN' }, date: '2025', value: null },
          { indicator: { id: 'SP.DYN.IMRT.IN' }, date: '2024', value: 25.5, obs_status: '' },
          { indicator: { id: 'SP.DYN.IMRT.IN' }, date: '2023', value: 26.2 },
        ],
      ]), { status: 200 })
    }) as unknown as typeof fetch
    const result = await fetchWorldBankHealthSeries('SP.DYN.IMRT.IN', 'DOM', 2023, 2025, request)
    expect(result.status).toBe('partial')
    expect(result.observations).toEqual([
      { year: 2023, value: 26.2, status: null, footnote: null },
      { year: 2024, value: 25.5, status: '', footnote: null },
      { year: 2025, value: null, status: null, footnote: null },
    ])
    expect(result.missingYears).toEqual([2025])
    expect(result.latestAvailableYear).toBe(2024)
    expect(result.unit).toBe('muertes por 1.000 nacidos vivos')
    expect(result.sourceUrl).toContain('format=json')
  })

  it('distinguishes missing provider data from failed network access', async () => {
    const empty = vi.fn(async () => new Response(JSON.stringify([
      { pages: 1 }, [{ indicator: { id: 'SH_UHC_SCI' }, date: '2025', value: null }],
    ]), { status: 200 })) as unknown as typeof fetch
    const nothing = await fetchWorldBankHealthSeries('SH_UHC_SCI', 'DO', 2025, 2025, empty)
    expect(nothing.status).toBe('empty')
    expect(nothing.observations[0]?.value).toBeNull()
    const offline = vi.fn(async () => { throw new Error('network blocked') }) as unknown as typeof fetch
    const absent = await fetchWorldBankHealthSeries('SH_UHC_SCI', 'DO', 2023, 2025, offline)
    expect(absent.status).toBe('unavailable')
    expect(absent.missingYears).toEqual([2023, 2024, 2025])
    expect(absent.warnings[0]).toContain('network blocked')
  })

  it('rejects invalid provider selectors and exposes a bounded tool', async () => {
    await expect(fetchWorldBankHealthSeries('unknown')).rejects.toThrow()
    await expect(fetchWorldBankHealthSeries('SH_UHC_SCI', '../../admin')).rejects.toThrow()
    await expect(fetchWorldBankHealthSeries('SH_UHC_SCI', 'DOM', 2025, 2015)).rejects.toThrow()
    expect(createWorldBankHealthSeriesTool().name).toBe('research_health_series')
  })
})
