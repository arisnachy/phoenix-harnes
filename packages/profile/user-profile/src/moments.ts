/** Calendar-aware, consent-gated moments. Facts are context, never canned greetings. */
import type { UserProfileSettings, PersonalMoment } from './types.ts'

export interface CalendarMoment {
  readonly id: string
  readonly label: string
  readonly kind: 'personal' | 'patriotic' | 'public' | 'cultural' | 'solemn'
  readonly source: 'profile' | 'calendar' | 'regional'
}
export interface PublicHoliday {
  readonly date: string
  readonly name: string
  readonly localName?: string
  readonly countryCode?: string
}
const HOLIDAY_API = 'https://date.nager.at/api/v3/PublicHolidays'
const COUNTRY_FALLBACK: Readonly<Record<string, readonly [string, string, CalendarMoment['kind']][]>> = {
  DO: [
    ['01-26', 'Natalicio de Juan Pablo Duarte', 'patriotic'],
    ['02-27', 'Independencia Nacional', 'patriotic'],
    ['08-16', 'Restauración de la República', 'patriotic'],
    ['11-06', 'Día de la Constitución', 'patriotic'],
  ],
}
const GLOBAL: readonly [string, string, CalendarMoment['kind']][] = [
  ['01-01', 'Año Nuevo', 'cultural'],
  ['10-31', 'Halloween', 'cultural'],
  ['12-25', 'Navidad', 'cultural'],
  ['12-31', 'Fin de año', 'cultural'],
]
const MONTHS: Readonly<Record<string, string>> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
  noviembre: '11', diciembre: '12',
}

/** Resolve an instant in an explicitly configured IANA zone (or the host's zone). */
export function calendarDay(now: Date, zone?: string): string {
  const format = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    ...(zone === undefined ? {} : { timeZone: zone }),
  })
  const parts = format.formatToParts(now)
  const part = (type: string) => parts.find(row => row.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
/** Annual dates accept MM-DD and full YYYY-MM-DD dates. Leap-day dates are valid. */
export function validAnnualDay(value: string): boolean {
  return /^\d{2}-\d{2}$/.test(value)
    ? validDay(`2024-${value}`)
    : validDay(value)
}
function matchesDay(date: string, today: string): boolean {
  return date.slice(-5) === today.slice(-5)
}
function kindFromHoliday(name: string): CalendarMoment['kind'] {
  return /independ|independenc|restaur|constituci|constitution|liberation|nacional|national|patria/i.test(name)
    ? 'patriotic'
    : /mourning|remembrance|memorial|conmemoración|duelo/i.test(name)
      ? 'solemn'
      : 'public'
}
/** Priority: personal, national/regional, public, then global; deduplicate labels. */
export function momentsForDay(
  profile: UserProfileSettings,
  today: string,
  publicHolidays: readonly PublicHoliday[] = [],
): CalendarMoment[] {
  if (!profile.consent.moments || !validDay(today)) return []
  const results: CalendarMoment[] = []
  const add = (value: CalendarMoment) => {
    if (!results.some(row => row.label.toLocaleLowerCase() === value.label.toLocaleLowerCase())) results.push(value)
  }
  if (profile.dateOfBirth !== undefined && profile.consent.dateOfBirth && matchesDay(profile.dateOfBirth, today)) {
    add({ id: 'personal:user-birthday', label: 'Cumpleaños del usuario', kind: 'personal', source: 'profile' })
  }
  for (const date of profile.specialDates ?? []) {
    if (matchesDay(date.date, today)) add({
      id: `personal:${date.date}:${date.label}`, label: date.label,
      kind: date.solemn === true ? 'solemn' : 'personal', source: 'profile',
    })
  }
  const country = profile.countryCode?.toUpperCase()
  for (const [date, label, kind] of COUNTRY_FALLBACK[country ?? ''] ?? []) {
    if (date === today.slice(-5)) add({ id: `regional:${country}:${date}`, label, kind, source: 'regional' })
  }
  for (const holiday of publicHolidays) {
    if (holiday.date !== today) continue
    if (country === undefined || holiday.countryCode !== country) continue
    const label = holiday.localName || holiday.name
    if (typeof label !== 'string' || label.length > 120 || label.trim() === '') continue
    add({ id: `calendar:${country}:${holiday.date}:${label}`, label, kind: kindFromHoliday(label + ' ' + holiday.name), source: 'calendar' })
  }
  for (const [date, label, kind] of GLOBAL) {
    if (date === today.slice(-5)) add({ id: `global:${date}`, label, kind, source: 'regional' })
  }
  return results
}

/** Only country and year are transmitted to the holiday provider, never personal profile fields. */
export async function fetchPublicHolidays(country: string, year: number, fetcher: typeof fetch = fetch): Promise<PublicHoliday[]> {
  if (!/^[A-Z]{2}$/.test(country) || !Number.isInteger(year) || year < 1900 || year > 2200) return []
  const response = await fetcher(`${HOLIDAY_API}/${year}/${country}`, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`Holiday API HTTP ${response.status}`)
  const data: unknown = await response.json()
  if (!Array.isArray(data)) return []
  return data.slice(0, 500).flatMap((entry): PublicHoliday[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const row = entry as Record<string, unknown>
    if (typeof row.date !== 'string' || !validDay(row.date)
      || typeof row.name !== 'string' || row.name.length > 120 || row.name.trim() === ''
      || row.countryCode !== country) return []
    return [{
      date: row.date, name: row.name, countryCode: country,
      ...(typeof row.localName === 'string' && row.localName.length <= 120 ? { localName: row.localName } : {}),
    }]
  })
}
/** Compact, non-directive context; Kira decides whether to mention a moment. */
export function renderMomentContext(profile: UserProfileSettings, holidays: readonly PublicHoliday[], now = new Date()): string {
  if (!profile.consent.moments) return ''
  const today = calendarDay(now, profile.momentsTimeZone)
  const events = momentsForDay(profile, today, holidays)
  if (events.length === 0) return ''
  return [
    `Relevant calendar context for ${today} (user zone):`,
    ...events.slice(0, 8).map(row => `- ${row.label} [${row.kind}; ${row.source}]`),
    'These are facts, not a request to greet or send a message. React naturally only if appropriate to the conversation; never use scripted greetings or repeat a celebration in every response. Treat solemn occasions respectfully. Do not infer personal relationships beyond what the user authorized.',
  ].join('\n')
}
/** A conservative Spanish detector; only saves when the user enabled moments memory. */
export function detectPersonalMoment(text: string): PersonalMoment | undefined {
  if (!/\b(mi hija|mi hijo|mi esposa|mi esposo|mi pareja|mi madre|mi padre|mi hermano|mi hermana|mi cumpleaños|mi cumpleaños|nuestro aniversario)\b/i.test(text)) return undefined
  if (!/\b(cumple|cumpleaños|aniversario)\b/i.test(text)) return undefined
  const match = /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/i.exec(text)
  if (match === null) return undefined
  const day = Number(match[1])
  const month = MONTHS[match[2]?.toLocaleLowerCase() ?? '']
  if (month === undefined) return undefined
  const date = `${month}-${String(day).padStart(2, '0')}`
  if (!validAnnualDay(date)) return undefined
  const relation = /\b(mi hija|mi hijo|mi esposa|mi esposo|mi pareja|mi madre|mi padre|mi hermano|mi hermana)\b/i.exec(text)?.[1]
  const label = /aniversario/i.test(text) ? 'Aniversario familiar' : relation === undefined
    ? 'Cumpleaños del usuario' : `Cumpleaños de ${relation.toLocaleLowerCase()}`
  return { date, label }
}
