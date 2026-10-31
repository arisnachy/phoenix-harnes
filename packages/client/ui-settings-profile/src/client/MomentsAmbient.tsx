/** Compact, consent-gated holiday accent; never injects messages or replaces the user's theme. */
import { useEffect, useState } from 'react'
import type { SettingsScope } from '@phoenix-ai/dsh-client-runtime/client'
import type { UserProfileSettings } from './types.ts'
import css from './MomentsAmbient.module.css'

interface Holiday { date: string; localName?: string; name: string; countryCode: string }
type Kind = 'personal' | 'patriotic' | 'public' | 'cultural' | 'solemn'
type Theme = 'halloween' | 'winter' | 'birthday' | 'patriotic' | 'solemn' | 'love' | 'nature' | 'general'
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
  const publicDay = holidays.find(row => row.date === today && row.countryCode === country)
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

/** Presentation-only palette; religious/patriotic meaning is never inferred from a user's identity. */
export function appearanceFor(moment: Occasion, country?: string): { icon: string; theme: Theme } {
  if (moment.kind === 'solemn') return { icon: '🕯️', theme: 'solemn' }
  if (moment.kind === 'patriotic') {
    const flag = country && /^[A-Z]{2}$/.test(country)
      ? [...country].map(letter => String.fromCodePoint(letter.charCodeAt(0) + 127397)).join('') : '🏳️'
    return { icon: flag, theme: 'patriotic' }
  }
  if (/halloween/i.test(moment.label)) return { icon: '🎃', theme: 'halloween' }
  if (/navidad|nochebuena|christmas/i.test(moment.label)) return { icon: '🎄', theme: 'winter' }
  if (/cumple|birthday|madres|padres|mothers|fathers/i.test(moment.label)) return {
    icon: /madres|mothers/i.test(moment.label) ? '💐' : '🎂', theme: 'birthday',
  }
  if (/amor|valentín|amistad|aniversario|love|friendship|wedding/i.test(moment.label)) {
    return { icon: '💝', theme: 'love' }
  }
  if (/tierra|ambiente|earth|environment/i.test(moment.label)) return { icon: '🌱', theme: 'nature' }
  if (/año nuevo|fin de año|new year/i.test(moment.label)) return { icon: '🎆', theme: 'general' }
  return { icon: '✨', theme: 'general' }
}

function variantFor(day: string, label: string): number {
  let seed = 0
  for (const letter of day + label) seed = (seed * 31 + letter.charCodeAt(0)) >>> 0
  return seed % 4
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
  const moment = occasionFor(profile, day, holidays)
  if (moment === undefined) return null
  const appearance = appearanceFor(moment, country)
  const variant = (variantFor(day, moment.label) + styleStep) % 4
  return (
    <button type="button" className={css.ambient} data-phoenix-moment={moment.kind}
      data-phoenix-theme={appearance.theme} data-variant={variant}
      aria-label={`${moment.label}. Cambiar decoración`} title={`${moment.label} · Cambiar decoración`}
      onClick={() => { setStyleStep(step => (step + 1) % 4) }}>
      <span className={css.symbol} aria-hidden="true">{appearance.icon}</span>
      <span className={css.label}>{moment.label}</span>
      <span className={css.spark} aria-hidden="true">✦</span>
    </button>
  )
}
