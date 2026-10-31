/** Compact, consent-gated holiday accent; never injects messages or replaces the user's theme. */
import { useEffect, useState } from 'react'
import type { SettingsScope } from '@phoenix-ai/dsh-client-runtime/client'
import type { UserProfileSettings } from './types.ts'
import css from './MomentsAmbient.module.css'
import { appearanceFor, occasionHash } from './moment-appearance.ts'
export { appearanceFor } from './moment-appearance.ts'

interface Holiday { date: string; localName?: string; name: string; countryCode: string; subdivisionCodes?: readonly string[]; nationalHoliday?: boolean; holidayTypes?: readonly string[] }
type Kind = 'personal' | 'patriotic' | 'public' | 'cultural' | 'solemn'
interface Occasion { label: string; kind: Kind }

const DOMINICAN = new Map<string, string>([
  ['01-21', 'Nuestra Señora de la Altagracia'],
  ['01-26', 'Natalicio de Juan Pablo Duarte'],
  ['02-27', 'Independencia Nacional'],
  ['08-16', 'Restauración de la República'],
  ['09-24', 'Nuestra Señora de las Mercedes'],
  ['11-06', 'Día de la Constitución'],
])
const UNIVERSAL = new Map<string, string>([
  ['01-01', 'Año Nuevo'], ['02-14', 'San Valentín'], ['03-08', 'Día Internacional de la Mujer'],
  ['03-20', 'Día Internacional de la Felicidad'], ['04-07', 'Día Mundial de la Salud'],
  ['04-22', 'Día de la Tierra'], ['05-01', 'Día Internacional de los Trabajadores'],
  ['06-05', 'Día Mundial del Medio Ambiente'], ['07-30', 'Día Internacional de la Amistad'],
  ['08-12', 'Día Internacional de la Juventud'], ['09-21', 'Día Internacional de la Paz'],
  ['10-10', 'Día Mundial de la Salud Mental'], ['10-31', 'Halloween'],
  ['11-20', 'Día Mundial de la Infancia'], ['12-10', 'Día de los Derechos Humanos'],
  ['12-24', 'Nochebuena'], ['12-25', 'Navidad'], ['12-31', 'Fin de año'],
])

export function localDay(now: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit',
    ...(timeZone === undefined ? {} : { timeZone }) }).formatToParts(now)
  const part = (type: string) => parts.find(row => row.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Only date, country and consent determine the occasion; private dates never reach the holiday API. */
export function occasionFor(profile: UserProfileSettings, today: string, holidays: readonly Holiday[]): Occasion | undefined {
  if (!profile.consent.moments) return undefined
  const md = today.slice(-5)
  if (profile.dateOfBirth?.slice(-5) === md && profile.consent.dateOfBirth) {
    return { label: 'Tu cumpleaños', kind: 'personal' }
  }
  const saved = profile.specialDates?.find(row => row.date.slice(-5) === md)
  if (saved !== undefined) return { label: saved.label, kind: saved.solemn ? 'solemn' : 'personal' }
  const country = profile.countryCode
  if (country === 'DO' && DOMINICAN.has(md)) {
    const label = DOMINICAN.get(md) ?? ''
    return { label, kind: /independencia|restauración|constitución|duarte/i.test(label) ? 'patriotic' : 'cultural' }
  }
  const publicDay = holidays.find(row => row.date === today && row.countryCode === country
    && (row.nationalHoliday === true || (row.subdivisionCodes?.length ?? 0) === 0 && row.nationalHoliday !== false
      || profile.momentsRegion !== undefined && row.subdivisionCodes?.includes(profile.momentsRegion)))
  if (publicDay !== undefined) {
    const name = publicDay.localName || publicDay.name
    return { label: name, kind: /independen|constituci|constitution|national|nacional|patria|restaur/i.test(name + ' ' + publicDay.name)
      ? 'patriotic' : /memorial|remembrance|duelo|mourning/i.test(name) ? 'solemn' : 'public' }
  }
  const year = Number(today.slice(0, 4))
  if (country === 'DO' && (md.startsWith('05-') || md.startsWith('07-'))) {
    const month = Number(md.slice(0, 2))
    const end = new Date(Date.UTC(year, month, 0))
    const sunday = end.getUTCDate() - end.getUTCDay()
    if (md === `${String(month).padStart(2, '0')}-${String(sunday).padStart(2, '0')}`) {
      return { label: month === 5 ? 'Día de las Madres' : 'Día de los Padres', kind: 'cultural' }
    }
  }
  if (country === 'US' && md.startsWith('11-')) {
    const first = new Date(Date.UTC(year, 10, 1)).getUTCDay()
    const thursday = 1 + ((4 - first + 7) % 7) + 21
    if (md === `11-${String(thursday).padStart(2, '0')}`) return { label: 'Acción de Gracias', kind: 'cultural' }
  }
  const universal = UNIVERSAL.get(md)
  return universal === undefined ? undefined : { label: universal, kind: 'cultural' }
}

/** Rotate multiple same-day events and eight local styles without opening a popup. */
function variantFor(day: string, label: string): number {
  return occasionHash(day + label) % 8
}

/** Badge themes and event choices rotate without a popup or changing the shell. */
export function MomentsAmbient(props: { scope: SettingsScope<UserProfileSettings> }) {
  const [profile, setProfile] = useState(() => props.scope.getSnapshot().value)
  const [now, setNow] = useState(() => new Date())
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [styleStep, setStyleStep] = useState(0)
  useEffect(() => props.scope.subscribe(() => { setProfile(props.scope.getSnapshot().value) }), [props.scope])
  useEffect(() => {
    const timer = setInterval(() => { setNow(new Date()) }, 60_000)
    return () => { clearInterval(timer) }
  }, [])
  const country = profile?.consent.moments ? profile.countryCode : undefined
  const day = localDay(now, profile?.momentsTimeZone)
  const year = Number(day.slice(0, 4))
  useEffect(() => {
    if (!country || !/^[A-Z]{2}$/.test(country)) { setHolidays([]); return }
    const controller = new AbortController()
    void fetch(`https://date.nager.at/api/v4/Holidays/${country}/${year}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<unknown> : [])
      .then((data) => {
        if (controller.signal.aborted || !Array.isArray(data)) return
        setHolidays(data.slice(0, 500).flatMap((item): Holiday[] => {
          if (typeof item !== 'object' || item === null) return []
          const holiday = item as Record<string, unknown>
          if (typeof holiday.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(holiday.date)
            || holiday.countryCode !== country || typeof holiday.name !== 'string'
            || holiday.name.length > 120 || holiday.name.trim() === '') return []
          const subdivisions = Array.isArray(holiday.subdivisionCodes)
            ? holiday.subdivisionCodes.filter((value): value is string => typeof value === 'string'
              && new RegExp(`^${country}-[A-Z0-9]{1,4}/** Compact, consent-gated holiday accent; never injects messages or replaces the user's theme. */
import { useEffect, useState } from 'react'
import type { SettingsScope } from '@phoenix-ai/dsh-client-runtime/client'
import type { UserProfileSettings } from './types.ts'
import css from './MomentsAmbient.module.css'
import { appearanceFor, occasionHash } from './moment-appearance.ts'
export { appearanceFor } from './moment-appearance.ts'

interface Holiday { date: string; localName?: string; name: string; countryCode: string; subdivisionCodes?: readonly string[]; nationalHoliday?: boolean; holidayTypes?: readonly string[] }
type Kind = 'personal' | 'patriotic' | 'public' | 'cultural' | 'solemn'
interface Occasion { label: string; kind: Kind }

const DOMINICAN = new Map<string, string>([
  ['01-21', 'Nuestra Señora de la Altagracia'],
  ['01-26', 'Natalicio de Juan Pablo Duarte'],
  ['02-27', 'Independencia Nacional'],
  ['08-16', 'Restauración de la República'],
  ['09-24', 'Nuestra Señora de las Mercedes'],
  ['11-06', 'Día de la Constitución'],
])
const UNIVERSAL = new Map<string, string>([
  ['01-01', 'Año Nuevo'], ['02-14', 'San Valentín'], ['03-08', 'Día Internacional de la Mujer'],
  ['03-20', 'Día Internacional de la Felicidad'], ['04-07', 'Día Mundial de la Salud'],
  ['04-22', 'Día de la Tierra'], ['05-01', 'Día Internacional de los Trabajadores'],
  ['06-05', 'Día Mundial del Medio Ambiente'], ['07-30', 'Día Internacional de la Amistad'],
  ['08-12', 'Día Internacional de la Juventud'], ['09-21', 'Día Internacional de la Paz'],
  ['10-10', 'Día Mundial de la Salud Mental'], ['10-31', 'Halloween'],
  ['11-20', 'Día Mundial de la Infancia'], ['12-10', 'Día de los Derechos Humanos'],
  ['12-24', 'Nochebuena'], ['12-25', 'Navidad'], ['12-31', 'Fin de año'],
])

export function localDay(now: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit',
    ...(timeZone === undefined ? {} : { timeZone }) }).formatToParts(now)
  const part = (type: string) => parts.find(row => row.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Only date, country and consent determine the occasion; private dates never reach the holiday API. */
export function occasionFor(profile: UserProfileSettings, today: string, holidays: readonly Holiday[]): Occasion | undefined {
  if (!profile.consent.moments) return undefined
  const md = today.slice(-5)
  if (profile.dateOfBirth?.slice(-5) === md && profile.consent.dateOfBirth) {
    return { label: 'Tu cumpleaños', kind: 'personal' }
  }
  const saved = profile.specialDates?.find(row => row.date.slice(-5) === md)
  if (saved !== undefined) return { label: saved.label, kind: saved.solemn ? 'solemn' : 'personal' }
  const country = profile.countryCode
  if (country === 'DO' && DOMINICAN.has(md)) {
    const label = DOMINICAN.get(md) ?? ''
    return { label, kind: /independencia|restauración|constitución|duarte/i.test(label) ? 'patriotic' : 'cultural' }
  }
  const publicDay = holidays.find(row => row.date === today && row.countryCode === country
    && (row.nationalHoliday === true || (row.subdivisionCodes?.length ?? 0) === 0 && row.nationalHoliday !== false
      || profile.momentsRegion !== undefined && row.subdivisionCodes?.includes(profile.momentsRegion)))
  if (publicDay !== undefined) {
    const name = publicDay.localName || publicDay.name
    return { label: name, kind: /independen|constituci|constitution|national|nacional|patria|restaur/i.test(name + ' ' + publicDay.name)
      ? 'patriotic' : /memorial|remembrance|duelo|mourning/i.test(name) ? 'solemn' : 'public' }
  }
  const year = Number(today.slice(0, 4))
  if (country === 'DO' && (md.startsWith('05-') || md.startsWith('07-'))) {
    const month = Number(md.slice(0, 2))
    const end = new Date(Date.UTC(year, month, 0))
    const sunday = end.getUTCDate() - end.getUTCDay()
    if (md === `${String(month).padStart(2, '0')}-${String(sunday).padStart(2, '0')}`) {
      return { label: month === 5 ? 'Día de las Madres' : 'Día de los Padres', kind: 'cultural' }
    }
  }
  if (country === 'US' && md.startsWith('11-')) {
    const first = new Date(Date.UTC(year, 10, 1)).getUTCDay()
    const thursday = 1 + ((4 - first + 7) % 7) + 21
    if (md === `11-${String(thursday).padStart(2, '0')}`) return { label: 'Acción de Gracias', kind: 'cultural' }
  }
  const universal = UNIVERSAL.get(md)
  return universal === undefined ? undefined : { label: universal, kind: 'cultural' }
}

/** Rotate multiple same-day events and eight local styles without opening a popup. */
function variantFor(day: string, label: string): number {
  return occasionHash(day + label) % 8
}

/** The badge has four small styles; click to preview the next one, no popup or banner. */
export function MomentsAmbient(props: { scope: SettingsScope<UserProfileSettings> }) {
  const [profile, setProfile] = useState(() => props.scope.getSnapshot().value)
  const [now, setNow] = useState(() => new Date())
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [styleStep, setStyleStep] = useState(0)
  useEffect(() => props.scope.subscribe(() => { setProfile(props.scope.getSnapshot().value) }), [props.scope])
  useEffect(() => {
    const timer = setInterval(() => { setNow(new Date()) }, 60_000)
    return () => { clearInterval(timer) }
  }, [])
  const country = profile?.consent.moments ? profile.countryCode : undefined
  const day = localDay(now, profile?.momentsTimeZone)
  const year = Number(day.slice(0, 4))
  useEffect(() => {
    if (!country || !/^[A-Z]{2}$/.test(country)) { setHolidays([]); return }
    const controller = new AbortController()
    void fetch(`https://date.nager.at/api/v4/Holidays/${country}/${year}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<unknown> : [])
      .then((data) => {
        if (controller.signal.aborted || !Array.isArray(data)) return
        setHolidays(data.slice(0, 500).flatMap((item): Holiday[] => {
          if (typeof item !== 'object' || item === null) return []
          const holiday = item as Record<string, unknown>
).test(value)).slice(0, 80)
            : undefined
          return [{ date: holiday.date, name: holiday.name, countryCode: country,
            ...(typeof holiday.localName === 'string' && holiday.localName.length < 120 ? { localName: holiday.localName } : {}),
            ...(subdivisions === undefined ? {} : { subdivisionCodes: subdivisions }),
            ...(typeof holiday.nationalHoliday === 'boolean' ? { nationalHoliday: holiday.nationalHoliday } : {}),
            ...(Array.isArray(holiday.holidayTypes) ? { holidayTypes: holiday.holidayTypes.filter(
              (type): type is string => typeof type === 'string' && type.length < 24,
            ).slice(0, 8) } : {}),
          }]
        }))
      }).catch(() => { if (!controller.signal.aborted) setHolidays([]) })
    return () => { controller.abort() }
  }, [country, year])
  if (!profile?.consent.moments) return null
  const primary = occasionFor(profile, day, holidays)
  if (primary === undefined) return null
  const events: Occasion[] = [primary]
  for (const row of holidays) {
    if (row.date !== day || row.countryCode !== country) continue
    if (row.nationalHoliday !== true && (row.subdivisionCodes?.length ?? 0) > 0
      && (profile.momentsRegion === undefined || !row.subdivisionCodes?.includes(profile.momentsRegion))) continue
    if (row.nationalHoliday === false && (row.subdivisionCodes?.length ?? 0) === 0) continue
    const label = row.localName || row.name
    if (!events.some(event => event.label === label)) events.push({ label, kind: 'public' })
  }
  const moment = events[styleStep % events.length] ?? primary
  const appearance = appearanceFor(moment, country)
  const variant = (variantFor(day, moment.label) + Math.floor(styleStep / events.length)) % 8
  return (
    <button type="button" className={css.ambient} data-phoenix-moment={moment.kind}
      data-phoenix-theme={appearance.theme} data-variant={variant}
      aria-label={`${moment.label}. Ver otra ambientación`} title={`${moment.label} · Cambiar ambientación`}
      onClick={() => { setStyleStep(step => (step + 1) % (events.length * 8)) }}>
      <span className={css.symbol} aria-hidden="true">{appearance.icon}</span>
      <span className={css.label}>{moment.label}</span>
      <span className={css.spark} aria-hidden="true">✦</span>
    </button>
  )
}
