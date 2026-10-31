import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ASSISTANT_GENDER,
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_USER_PROFILE_CONSENT,
  calendarDay,
  detectPersonalMoment,
  fetchPublicHolidays,
  momentsForDay,
  renderMomentContext,
  validAnnualDay,
  validateUserProfile,
} from '@phoenix-ai/dsh-user-profile'
import type { UserProfileSettings } from '@phoenix-ai/dsh-user-profile'

function profile(patch: Partial<UserProfileSettings> = {}): UserProfileSettings {
  return {
    assistantName: DEFAULT_ASSISTANT_NAME,
    assistantGender: DEFAULT_ASSISTANT_GENDER,
    consent: { ...DEFAULT_USER_PROFILE_CONSENT, moments: true },
    countryCode: 'DO',
    momentsTimeZone: 'America/Santo_Domingo',
    ...patch,
  }
}

describe('PHOENIX Moments calendar facts', () => {
  it('knows exact local day independent of UTC date and supports leap days', () => {
    expect(calendarDay(new Date('2026-11-01T02:30:00Z'), 'America/Santo_Domingo')).toBe('2026-10-31')
    expect(validAnnualDay('02-29')).toBe(true)
    expect(validAnnualDay('02-30')).toBe(false)
    expect(validAnnualDay('2025-02-29')).toBe(false)
    expect(validAnnualDay('2024-02-29')).toBe(true)
  })

  it('exposes no personal or cultural facts before explicit consent', () => {
    const disabled = profile({ dateOfBirth: '1982-02-20', specialDates: [{ date: '02-20', label: 'Familia' }],
      consent: { ...DEFAULT_USER_PROFILE_CONSENT, dateOfBirth: true } })
    expect(momentsForDay(disabled, '2026-02-20')).toEqual([])
    expect(renderMomentContext(disabled, [], new Date('2026-02-20T12:00:00Z'))).toBe('')
    const enabledWithoutDob = profile({ dateOfBirth: '1982-02-20' })
    expect(momentsForDay(enabledWithoutDob, '2026-02-20')).toEqual([])
  })

  it('prioritizes birthday and personal dates over patriotic and public observations', () => {
    const p = profile({
      dateOfBirth: '1982-02-27',
      consent: { ...DEFAULT_USER_PROFILE_CONSENT, moments: true, dateOfBirth: true },
      specialDates: [
        { date: '02-27', label: 'Cumpleaños de Abril' },
        { date: '02-27', label: 'Recordatorio solemne', solemn: true },
      ],
    })
    const rows = momentsForDay(p, '2026-02-27', [
      { countryCode: 'DO', date: '2026-02-27', name: 'Independence Day', localName: 'Independencia Nacional' },
      { countryCode: 'US', date: '2026-02-27', name: 'Foreign holiday' },
      { countryCode: 'DO', date: '2026-02-28', name: 'Wrong day' },
    ])
    expect(rows[0]).toMatchObject({ kind: 'personal', label: 'Cumpleaños del usuario' })
    expect(rows[1]).toMatchObject({ kind: 'personal', label: 'Cumpleaños de Abril' })
    expect(rows[2]).toMatchObject({ kind: 'solemn', label: 'Recordatorio solemne' })
    expect(rows.some(row => row.kind === 'patriotic')).toBe(true)
    expect(rows.some(row => row.label === 'Foreign holiday')).toBe(false)
    expect(rows.some(row => row.label === 'Wrong day')).toBe(false)
    const prompt = renderMomentContext(p, [], new Date('2026-02-27T12:00:00Z'))
    expect(prompt).toContain('not a request to greet')
    expect(prompt).toContain('Cumpleaños de Abril')
    expect(prompt).not.toContain('1982-02-27')
  })

  it('handles Halloween and national occasions as facts without fabricated private data', () => {
    expect(momentsForDay(profile(), '2026-10-31')).toContainEqual({
      id: 'global:10-31', label: 'Halloween', kind: 'cultural', source: 'regional',
    })
    expect(momentsForDay(profile(), '2026-08-16')[0]?.label).toBe('Restauración de la República')
    expect(momentsForDay(profile({ countryCode: 'US' }), '2026-08-16')).toEqual([])
    expect(momentsForDay(profile(), 'bad-date')).toEqual([])
  })

  it('can learn conservative annual dates without guessing a date from unrelated text', () => {
    expect(detectPersonalMoment('El 15 de noviembre cumple años mi hija')).toMatchObject({
      date: '11-15', label: 'Cumpleaños de mi hija',
    })
    expect(detectPersonalMoment('Nuestro aniversario es el 3 de mayo')).toEqual({
      date: '05-03', label: 'Aniversario familiar',
    })
    expect(detectPersonalMoment('El 50 de noviembre cumple años mi hija')).toBeUndefined()
    expect(detectPersonalMoment('La paciente cumple años el 15 de noviembre')).toBeUndefined()
    expect(detectPersonalMoment('Mi hija cumple años pronto')).toBeUndefined()
  })

  it('validates country, zone and personal occasions before persistence', () => {
    expect(() => validateUserProfile(profile())).not.toThrow()
    expect(() => validateUserProfile(profile({ countryCode: 'DOM' }))).toThrow('countryCode')
    expect(() => validateUserProfile(profile({ momentsTimeZone: 'Moon/Sea' }))).toThrow('momentsTimeZone')
    expect(() => validateUserProfile(profile({ specialDates: [{ date: '02-30', label: 'Invalid' }] }))).toThrow('invalid date')
    expect(() => validateUserProfile(profile({ specialDates: [{ date: '02-20', label: '' }] }))).toThrow('cannot be empty')
  })

  it('fetches country-only public holidays and filters invalid provider records', async () => {
    const fakeFetch = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => [
        { date: '2026-07-04', name: 'Independence Day', localName: 'Día de la Independencia', countryCode: 'US' },
        { date: '2026-07-04', name: 'Other', countryCode: 'CA' },
        { date: '2026-02-30', name: 'Invalid date', countryCode: 'US' },
      ],
    })) as unknown as typeof fetch
    const holidays = await fetchPublicHolidays('US', 2026, fakeFetch)
    expect(holidays).toEqual([{
      date: '2026-07-04', name: 'Independence Day', localName: 'Día de la Independencia', countryCode: 'US',
    }])
    expect(vi.mocked(fakeFetch).mock.calls[0]?.[0]).toContain('/2026/US')
    expect(await fetchPublicHolidays('bad', 2026, fakeFetch)).toEqual([])
  })
})
