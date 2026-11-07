import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  annualCalendar, celebrationGreeting, celebrationsOn, fetchCountryHolidays,
  normalizedCountry,
} from '../src/client/skeleton/celebrations.ts'

const day = (text: string) => new Date(text + 'T12:00:00')

afterEach(() => { vi.unstubAllGlobals() })

describe('PHOENIX world celebrations', () => {
  it('keeps the official Dominican independence and restoration dates', () => {
    const events = annualCalendar(2026)
    expect(events.find(e => e.label === 'Día de la Independencia Nacional')?.date).toBe('2026-02-27')
    expect(events.find(e => e.label === 'Día de la Restauración')?.date).toBe('2026-08-16')
    expect(events.find(e => e.label === 'Día del Médico Dominicano')?.date).toBe('2026-08-18')
    expect(events.find(e => e.label === 'Día del Maestro Dominicano')?.date).toBe('2026-06-30')
    expect(events.find(e => e.label === 'Corpus Christi')?.date).toBe('2026-06-04')
    expect(events.find(e => e.label === 'Viernes Santo')?.date).toBe('2026-04-03')
  })

  it('computes movable mothers, fathers, Thanksgiving and Black Friday', () => {
    const events = annualCalendar(2026)
    const get = (label: string) => events.find(e => e.label === label)?.date
    expect(get('Día de las Madres')).toBe('2026-05-31')
    expect(get('Día de los Padres')).toBe('2026-07-26')
    expect(get("Mother's Day")).toBe('2026-05-10')
    expect(get("Father's Day")).toBe('2026-06-21')
    expect(get('Thanksgiving Day')).toBe('2026-11-26')
    expect(get('Black Friday')).toBe('2026-11-27')
    expect(get('Memorial Day')).toBe('2026-05-25')
    expect(get('Martin Luther King Jr. Day')).toBe('2026-01-19')
  })

  it('ranks the origin country and never displays an unrelated foreign independence', () => {
    const date = day('2026-09-16')
    const mexico = celebrationsOn(date, { countryOfOrigin: 'MX', countryOfResidence: 'DO' })
    expect(mexico[0]?.label).toBe('Independencia de México')
    const dominican = celebrationsOn(date, { countryOfOrigin: 'DO', countryOfResidence: 'DO' })
    expect(dominican.some(x=> x.label === 'Independencia de México')).toBe(false)
  })

  it('personalizes birthdays and avoids congratulating solemn commemorations', () => {
    const birthday = celebrationsOn(day('2026-02-20'), { countryOfOrigin: 'DO', dateOfBirth: '1982-02-20' })[0]
    expect(birthday?.id).toBe('birthday')
    expect(celebrationGreeting(birthday!, 'Arisnachy')).toBe('¡Feliz cumpleaños, Arisnachy!')
    const solemn = celebrationsOn(day('2026-01-27'), {})[0]
    expect(solemn?.tone).toBe('solemn')
    expect(celebrationGreeting(solemn!)).toMatch(/^Hoy recordamos:/)
  })

  it('shows professional days only when the profession was shared', () => {
    const date = day('2026-08-18')
    expect(celebrationsOn(date, { countryOfOrigin: 'DO' }).some(e=>e.label==='Día del Médico Dominicano')).toBe(false)
    const physician = celebrationsOn(date, { countryOfOrigin: 'DO', profession: 'Médico de familia' })
    expect(physician[0]?.label).toBe('Día del Médico Dominicano')
  })

  it('validates country codes and rejects malformed or unrelated API records', async () => {
    expect(normalizedCountry('do')).toBe('DO')
    expect(normalizedCountry('../US')).toBeUndefined()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { date:'2027-01-01', countryCode:'FR', name:'Jour de l’an', nationalHoliday:true,
          holidayTypes:['Public'], subdivisionCodes:[] },
        { date:'2027-01-01', countryCode:'US', name:'Forged', holidayTypes:['Public'] },
        { date:'2027-01-02', countryCode:'FR', name:'State celebration',
          holidayTypes:['Observance'], subdivisionCodes:['FR-75'] },
        { date:'2027-01-03', countryCode:'FR', name:'Other', holidayTypes:['Unknown'] },
      ],
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchCountryHolidays(2027, 'FR')
    expect(result).toHaveLength(2)
    expect(result[1]?.stateCodes).toEqual(['FR-75'])
    expect(celebrationsOn(day('2027-01-02'), {countryOfOrigin:'FR'}, result)).toHaveLength(0)
    expect(celebrationsOn(day('2027-01-02'), {countryOfOrigin:'FR',stateCode:'FR-75'}, result)[0]?.label).toBe('State celebration')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await fetchCountryHolidays(2027, 'FR')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid external responses rather than displaying a made-up celebration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true,json:async()=>({bad:true})}))
    await expect(fetchCountryHolidays(2099,'ES')).rejects.toThrow('Invalid holiday response')
    await expect(fetchCountryHolidays(2099,'TOO_LONG')).resolves.toEqual([])
  })

  it('rejects outside the supported year horizon', () => {
    expect(annualCalendar(2200)).toEqual([])
    expect(annualCalendar(1899)).toEqual([])
  })
})
