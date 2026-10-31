/** Subtle opt-in calendar ambient; never inserts chat messages or overrides the base theme. */
import { useEffect, useState } from 'react'
import type { SettingsScope } from '@phoenix-ai/dsh-client-runtime/client'
import type { UserProfileSettings } from './types.ts'
import css from './MomentsAmbient.module.css'

interface Holiday { date: string; localName?: string; name: string; countryCode: string }
interface Occasion { label: string; kind: 'personal' | 'patriotic' | 'public' | 'cultural' | 'solemn' }
const DOMINICAN = new Map<string, string>([
  ['01-26', 'Natalicio de Juan Pablo Duarte'],
  ['02-27', 'Independencia Nacional'],
  ['08-16', 'Restauración de la República'],
  ['11-06', 'Día de la Constitución'],
])
const UNIVERSAL = new Map<string, string>([
  ['01-01', 'Año Nuevo'], ['10-31', 'Halloween'], ['12-25', 'Navidad'], ['12-31', 'Fin de año'],
])
function localDay(now: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit',
    ...(timeZone === undefined ? {} : { timeZone }) }).formatToParts(now)
  const part = (type: string) => parts.find(row => row.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
function occasion(profile: UserProfileSettings, today: string, holidays: readonly Holiday[]): Occasion | undefined {
  if (!profile.consent.moments) return undefined
  const md = today.slice(-5)
  if (profile.dateOfBirth?.slice(-5) === md && profile.consent.dateOfBirth) return { label: 'Tu cumpleaños', kind: 'personal' }
  const saved = profile.specialDates?.find(row => row.date.slice(-5) === md)
  if (saved !== undefined) return { label: saved.label, kind: saved.solemn ? 'solemn' : 'personal' }
  if (profile.countryCode === 'DO' && DOMINICAN.has(md)) return { label: DOMINICAN.get(md) ?? '', kind: 'patriotic' }
  const publicDay = holidays.find(row => row.date === today && row.countryCode === profile.countryCode)
  if (publicDay !== undefined) {
    const name = publicDay.localName || publicDay.name
    return { label: name, kind: /independen|constituci|constitut|nacional|national|restaur/i.test(name) ? 'patriotic' : 'public' }
  }
  const universal = UNIVERSAL.get(md)
  return universal === undefined ? undefined : { label: universal, kind: 'cultural' }
}
function variantFor(today: string, label: string): number {
  let number = 0
  for (const letter of today + label) number = (number * 31 + letter.charCodeAt(0)) >>> 0
  return number % 3
}
/** Nonblocking shell decoration: personal dates never leave the browser for lookup. */
export function MomentsAmbient(props: { scope: SettingsScope<UserProfileSettings> }) {
  const [profile, setProfile] = useState(() => props.scope.getSnapshot().value)
  const [now, setNow] = useState(() => new Date())
  const [holidays, setHolidays] = useState<Holiday[]>([])
  useEffect(() => props.scope.subscribe(() => { setProfile(props.scope.getSnapshot().value) }), [props.scope])
  useEffect(() => {
    const timer = setInterval(() => { setNow(new Date()) }, 60_000)
    return () => { clearInterval(timer) }
  }, [])
  const country = profile?.consent.moments ? profile.countryCode : undefined
  const year = now.getFullYear()
  useEffect(() => {
    if (!country || !/^[A-Z]{2}$/.test(country)) { setHolidays([]); return }
    const controller = new AbortController()
    void fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<unknown> : [])
      .then((data) => {
        if (controller.signal.aborted || !Array.isArray(data)) return
        setHolidays(data.slice(0, 500).flatMap((item): Holiday[] => {
          if (typeof item !== 'object' || item === null) return []
          const holiday = item as Record<string, unknown>
          return typeof holiday.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(holiday.date)
            && holiday.countryCode === country && typeof holiday.name === 'string' && holiday.name.length < 120
            ? [{ date: holiday.date, name: holiday.name, countryCode: country,
              ...(typeof holiday.localName === 'string' && holiday.localName.length < 120 ? { localName: holiday.localName } : {}) }]
            : []
        }))
      }).catch(() => { if (!controller.signal.aborted) setHolidays([]) })
    return () => { controller.abort() }
  }, [country, year])
  if (!profile?.consent.moments) return null
  const day = localDay(now, profile.momentsTimeZone)
  const moment = occasion(profile, day, holidays)
  if (moment === undefined) return null
  const flag = profile.countryCode?.replace(/./g, letter => String.fromCodePoint(letter.charCodeAt(0) + 127397)) ?? '🏳️'
  const emoji = moment.kind === 'personal' ? '🎂' : moment.kind === 'patriotic' ? flag : moment.kind === 'solemn' ? '🕯️'
    : moment.label === 'Halloween' ? '🎃' : moment.label === 'Navidad' ? '🎄' : '✨'
  const variant = variantFor(day, moment.label)
  return (
    <div className={css.ambient} data-phoenix-moment={moment.kind} data-variant={variant} aria-label={moment.label} title={moment.label}>
      <span className={css.symbol} aria-hidden="true">{emoji}</span>
      <span className={css.label}>{moment.label}</span>
      <span className={css.spark} aria-hidden="true">✦</span>
    </div>
  )
}
