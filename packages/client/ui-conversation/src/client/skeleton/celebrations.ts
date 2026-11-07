/**
 * PHOENIX Celebrations: country-aware, year-aware calendar for the welcome hero.
 * Official public holidays are extended at runtime via Nager.Holidays v4;
 * this curated offline layer covers patriotic, international and personal dates.
 * A commemoration must never be framed as a festive congratulation.
 */
export type CelebrationTheme =
  | 'patriotic' | 'family' | 'new-year' | 'winter' | 'spring' | 'culture'
  | 'health' | 'education' | 'science' | 'environment' | 'equality'
  | 'peace' | 'autumn' | 'birthday'
export type CelebrationTone = 'festive' | 'recognition' | 'solemn'
export interface Celebration {
  id: string
  label: string
  date: string
  country: string
  theme: CelebrationTheme
  tone: CelebrationTone
  audience?: 'medical' | 'education' | undefined
  source: 'curated' | 'nager' | 'personal'
  stateCodes?: readonly string[] | undefined
  priority?: number | undefined
}
export interface CalendarProfile {
  /** Explicit preference from private user-profile settings. Never infer nationality. */
  countryOfOrigin?: string | undefined
  /** Locale region; only a fallback for what to display, not a claim of origin. */
  countryOfResidence?: string | undefined
  stateCode?: string | undefined
  profession?: string | undefined
  dateOfBirth?: string | undefined
  specialDates?: readonly { date: string; label: string; solemn?: boolean }[] | undefined
}
type Rule = { country: string; label: string; theme: CelebrationTheme; tone?: CelebrationTone; month: number; weekday?: number; nth?: number; easterOffset?: number; dayOffset?: number; audience?: Celebration['audience']; id?: string }
const YEAR = 2026

function fixed(country: string, lines: string): Celebration[] {
  return lines.trim().split('\n').map((line, index) => {
    const [monthDay, label, theme, tone, audience] = line.trim().split('|')
    return {
      id: `${country.toLowerCase()}-${monthDay}-${index}`,
      label: label ?? '',
      date: `${YEAR}-${monthDay}`,
      country,
      theme: (theme ?? 'culture') as CelebrationTheme,
      tone: (tone ?? 'festive') as CelebrationTone,
      ...(audience ? { audience: audience as Celebration['audience'] } : {}),
      source: 'curated' as const,
    }
  })
}

/** Verified 2026 Dominican holidays + locally prominent non-labor celebrations. */
const DOMINICAN = fixed('DO', `
01-01|Año Nuevo|new-year
01-06|Día de los Santos Reyes|culture
01-21|Nuestra Señora de la Altagracia|culture|recognition
01-26|Natalicio de Juan Pablo Duarte|patriotic|recognition
02-27|Día de la Independencia Nacional|patriotic
03-08|Día Internacional de la Mujer|equality|recognition
05-01|Día del Trabajo|culture|recognition
05-30|Día de la Libertad|patriotic|recognition
06-30|Día del Maestro Dominicano|education|festive|education
08-16|Día de la Restauración|patriotic
08-18|Día del Médico Dominicano|health|festive|medical
09-24|Nuestra Señora de las Mercedes|culture|recognition
11-06|Día de la Constitución|patriotic
12-24|Nochebuena|winter
12-25|Navidad|winter
12-31|Nochevieja|new-year
`)
/** Major US federal and widely recognized cultural dates, excluding movable rules. */
const UNITED_STATES = fixed('US', `
01-01|New Year's Day|new-year
02-02|Groundhog Day|culture
02-14|Valentine's Day|family
03-30|National Doctors' Day|health|festive|medical
04-22|Earth Day|environment|recognition
06-14|Flag Day|patriotic|recognition
06-19|Juneteenth National Independence Day|patriotic
07-04|Independence Day|patriotic
09-17|Constitution Day|patriotic|recognition
10-31|Halloween|autumn
11-11|Veterans Day|patriotic|recognition
12-24|Christmas Eve|winter
12-25|Christmas Day|winter
12-31|New Year's Eve|new-year
`)
/** Country-specific national independence/identity dates across Latin America. */
const LATAM = [
  ['HT','01-01','Independencia de Haití'],
  ['VE','07-05','Independencia de Venezuela'],
  ['AR','07-09','Independencia de Argentina'],
  ['CO','07-20','Independencia de Colombia'],
  ['PE','07-28','Independencia del Perú'],
  ['BO','08-06','Independencia de Bolivia'],
  ['EC','08-10','Primer Grito de Independencia de Ecuador'],
  ['UY','08-25','Declaratoria de Independencia de Uruguay'],
  ['BR','09-07','Independencia de Brasil'],
  ['CR','09-15','Independencia de Costa Rica'],
  ['SV','09-15','Independencia de El Salvador'],
  ['GT','09-15','Independencia de Guatemala'],
  ['HN','09-15','Independencia de Honduras'],
  ['NI','09-15','Independencia de Nicaragua'],
  ['MX','09-16','Independencia de México'],
  ['CL','09-18','Fiestas Patrias de Chile'],
  ['BZ','09-21','Independencia de Belice'],
  ['PY','05-14','Independencia de Paraguay'],
  ['CU','05-20','Conmemoración de la independencia de Cuba'],
  ['PA','11-03','Separación de Panamá de Colombia'],
  ['PA','11-28','Independencia de Panamá de España'],
  ['JM','08-06','Independencia de Jamaica'],
  ['TT','08-31','Independencia de Trinidad y Tobago'],
  ['GY','05-26','Independencia de Guyana'],
  ['SR','11-25','Independencia de Surinam'],
] as const
const LATIN_AMERICA: Celebration[] = LATAM.map(([country, mmdd, label], index) => ({
  id: `nation-${country}-${index}`, country, label, date: `${YEAR}-${mmdd}`,
  theme: 'patriotic', tone: country === 'CU' || (country === 'EC') ? 'recognition' : 'festive', source: 'curated',
}))
/** Fixed international observances aligned to UN, UNESCO and WHO calendars. */
const WORLD = fixed('WORLD', `
01-04|Día Mundial del Braille|education|recognition
01-24|Día Internacional de la Educación|education|recognition
01-27|Memoria de las Víctimas del Holocausto|peace|solemn
02-04|Día Mundial contra el Cáncer|health|recognition
02-11|Mujer y Niña en la Ciencia|science|recognition
02-21|Día Internacional de la Lengua Materna|culture|recognition
03-03|Día Mundial de la Vida Silvestre|environment|recognition
03-08|Día Internacional de la Mujer|equality|recognition
03-14|Día Internacional de las Matemáticas|science|recognition
03-20|Día Internacional de la Felicidad|family
03-21|Día Mundial del Síndrome de Down|health|recognition
03-22|Día Mundial del Agua|environment|recognition
03-24|Día Mundial de la Tuberculosis|health|recognition
04-02|Día Mundial de Concienciación sobre el Autismo|health|recognition
04-07|Día Mundial de la Salud|health|recognition
04-22|Día Internacional de la Madre Tierra|environment|recognition
04-23|Día Mundial del Libro y del Derecho de Autor|education|recognition
04-25|Día Mundial del Paludismo|health|recognition
05-03|Día Mundial de la Libertad de Prensa|peace|recognition
05-15|Día Internacional de las Familias|family|recognition
05-17|Día Mundial de las Telecomunicaciones|science|recognition
05-22|Día Internacional de la Diversidad Biológica|environment|recognition
05-31|Día Mundial Sin Tabaco|health|recognition
06-05|Día Mundial del Medio Ambiente|environment|recognition
06-08|Día Mundial de los Océanos|environment|recognition
06-14|Día Mundial del Donante de Sangre|health|recognition
06-20|Día Mundial de los Refugiados|peace|recognition
06-21|Día Internacional del Yoga|health|recognition
07-11|Día Mundial de la Población|education|recognition
07-18|Día Internacional de Nelson Mandela|peace|recognition
08-09|Día Internacional de los Pueblos Indígenas|culture|recognition
08-12|Día Internacional de la Juventud|family|recognition
08-19|Día Mundial de la Asistencia Humanitaria|peace|recognition
09-08|Día Internacional de la Alfabetización|education|recognition
09-10|Día Mundial para la Prevención del Suicidio|health|solemn
09-17|Día Mundial de la Seguridad del Paciente|health|recognition
09-21|Día Internacional de la Paz|peace|recognition
09-27|Día Mundial del Turismo|culture|recognition
09-29|Día Mundial del Corazón|health|recognition
10-01|Día Internacional de las Personas de Edad|family|recognition
10-05|Día Mundial de los Docentes|education|recognition
10-10|Día Mundial de la Salud Mental|health|recognition
10-11|Día Internacional de la Niña|equality|recognition
10-16|Día Mundial de la Alimentación|environment|recognition
10-24|Día de las Naciones Unidas|peace|recognition
11-10|Día Mundial de la Ciencia para la Paz y el Desarrollo|science|recognition
11-14|Día Mundial de la Diabetes|health|recognition
11-16|Día Internacional de la Tolerancia|peace|recognition
11-20|Día Mundial de la Infancia|family|recognition
11-25|Eliminación de la Violencia contra la Mujer|equality|solemn
12-01|Día Mundial de la Lucha contra el Sida|health|recognition
12-03|Día Internacional de las Personas con Discapacidad|equality|recognition
12-10|Día de los Derechos Humanos|peace|recognition
12-12|Día de la Cobertura Sanitaria Universal|health|recognition
12-18|Día Internacional del Migrante|culture|recognition
`)

const MOVABLE: readonly Rule[] = [
  { country: 'DO', label: 'Día de las Madres', theme: 'family', month: 5, weekday: 0, nth: -1 },
  { country: 'DO', label: 'Día de los Padres', theme: 'family', month: 7, weekday: 0, nth: -1 },
  { country: 'DO', label: 'Viernes Santo', theme: 'culture', month: 4, easterOffset: -2, tone: 'solemn' },
  { country: 'DO', label: 'Corpus Christi', theme: 'culture', month: 6, easterOffset: 60, tone: 'recognition' },
  { country: 'US', label: 'Martin Luther King Jr. Day', theme: 'peace', month: 1, weekday: 1, nth: 3, tone: 'recognition' },
  { country: 'US', label: "Washington's Birthday", theme: 'patriotic', month: 2, weekday: 1, nth: 3, tone: 'recognition' },
  { country: 'US', label: "Mother's Day", theme: 'family', month: 5, weekday: 0, nth: 2 },
  { country: 'US', label: 'Memorial Day', theme: 'peace', month: 5, weekday: 1, nth: -1, tone: 'solemn' },
  { country: 'US', label: "Father's Day", theme: 'family', month: 6, weekday: 0, nth: 3 },
  { country: 'US', label: 'Labor Day', theme: 'culture', month: 9, weekday: 1, nth: 1, tone: 'recognition' },
  { country: 'US', label: 'Columbus Day', theme: 'culture', month: 10, weekday: 1, nth: 2, tone: 'recognition' },
  { country: 'US', label: 'Thanksgiving Day', theme: 'family', month: 11, weekday: 4, nth: 4 },
  { country: 'US', label: 'Black Friday', theme: 'culture', month: 11, weekday: 4, nth: 4, dayOffset: 1, id: 'black-friday' },
]
function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}
function gregorianEaster(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19*a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2*e + 2*i - h - k + 7*7) % 7
  const m = Math.floor((a + 11*h + 22*l) / 451)
  const n = h + l - 7*m + 114
  return utcDate(year, Math.floor(n/31), (n%31)+1)
}
function resolveRule(year: number, rule: Rule): string {
  let d: Date
  if (rule.easterOffset !== undefined) {
    d = gregorianEaster(year)
    d.setUTCDate(d.getUTCDate() + rule.easterOffset)
  } else {
    const first = utcDate(year, rule.month, 1)
    const weekday = rule.weekday ?? 0
    const nth = rule.nth ?? 1
    const day = nth === -1
      ? new Date(Date.UTC(year, rule.month, 0)).getUTCDate()
      : 1 + (weekday - first.getUTCDay() + 7) % 7 + (nth-1)*7
    const last = utcDate(year, rule.month, day)
    d = nth === -1
      ? utcDate(year, rule.month, day - (last.getUTCDay() - weekday + 7) % 7)
      : last
  }
  if (rule.dayOffset) d.setUTCDate(d.getUTCDate() + rule.dayOffset)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
}
function annualYear(event: Celebration, year: number): Celebration {
  return { ...event, date: `${year}${event.date.slice(4)}` }
}
/** Explicit country codes win; locale is a residence-only fallback. */
export function normalizedCountry(value: string | undefined): string | undefined {
  const v = value?.toUpperCase().trim()
  return v && /^[A-Z]{2}$/.test(v) ? v : undefined
}
export function annualCalendar(year: number): Celebration[] {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return []
  const fixedEvents = [...DOMINICAN, ...UNITED_STATES, ...LATIN_AMERICA, ...WORLD].map(x=>annualYear(x,year))
  const move = MOVABLE.map((rule, index) => ({
    id: rule.id ?? `movable-${rule.country}-${index}`,
    date: resolveRule(year, rule), label: rule.label, country: rule.country,
    theme: rule.theme, tone: rule.tone ?? 'festive' as CelebrationTone,
    ...(rule.audience ? {audience:rule.audience}:{}), source: 'curated' as const,
    ...(rule.id === 'black-friday' ? { priority: -5 }: {}),
  }))
  if (year === 2026) {
    // Observed labor-calendar dates are distinct from their actual celebrations.
    fixedEvents.push(...fixed('DO', `
01-05|Feriado observado por el Día de Reyes|culture|recognition
05-04|Feriado observado por el Día del Trabajo|culture|recognition
11-09|Feriado observado por el Día de la Constitución|patriotic|recognition
`))
  }
  return [...fixedEvents, ...move]
}
function inScope(event: Celebration, profile: CalendarProfile): boolean {
  if (event.country === 'WORLD' || event.country === 'PERSONAL') return true
  if (event.stateCodes?.length && (!profile.stateCode || !event.stateCodes.includes(profile.stateCode))) return false
  const country = normalizedCountry(event.country)
  return country !== undefined && (country === normalizedCountry(profile.countryOfOrigin) || country === normalizedCountry(profile.countryOfResidence))
}
function relevantProfession(event: Celebration, profile: CalendarProfile): boolean {
  if (!event.audience) return true
  const p = (profile.profession ?? '').toLowerCase()
  return event.audience === 'medical'
    ? /médic|medic|doctor|enferm|nurs|salud/.test(p)
    : /docent|profesor|teacher|maestr|educador/.test(p)
}
function score(event: Celebration, profile: CalendarProfile): number {
  if (event.country === 'PERSONAL') return 1000
  const origin = normalizedCountry(profile.countryOfOrigin)
  const residence = normalizedCountry(profile.countryOfResidence)
  const base = event.country === origin ? 500 : event.country === residence ? 350 : event.country === 'WORLD' ? 150 : 0
  const tone = event.tone === 'festive' ? 8 : event.tone === 'recognition' ? 4 : 1
  return base + (event.audience ? 80 : 0) + tone + (event.priority ?? 0)
}
function personalEvents(date: string, profile: CalendarProfile): Celebration[] {
  const out: Celebration[] = []
  if (/^\d{4}-\d{2}-\d{2}$/.test(profile.dateOfBirth ?? '') && profile.dateOfBirth?.slice(5) === date.slice(5)) {
    out.push({ id: 'birthday', date, country: 'PERSONAL', theme: 'birthday', tone: 'festive', label: 'cumpleaños', source: 'personal' })
  }
  for (const [i, moment] of (profile.specialDates ?? []).entries()) {
    if (moment.date.slice(-5) === date.slice(5) || moment.date === date) {
      out.push({ id:`personal-${i}`, date, country:'PERSONAL', theme: moment.solemn ? 'peace' : 'family',
        tone: moment.solemn ? 'solemn':'festive', label:moment.label, source:'personal' })
    }
  }
  holidayCache.set(key, { at: Date.now(), events: out })
  return out
}
/** Select contextual events, never show a national celebration from unrelated countries. */
export function celebrationsOn(date: Date, profile: CalendarProfile, external: readonly Celebration[] = []): Celebration[] {
  const day = iso(date)
  const events = [...personalEvents(day,profile), ...annualCalendar(date.getFullYear()), ...external]
  const seen = new Set<string>()
  return events.filter(event => event.date === day && inScope(event,profile) && relevantProfession(event,profile))
    .filter(event => {const key = `${event.country}:${event.label.toLocaleLowerCase()}`; if(seen.has(key))return false;seen.add(key);return true})
    .sort((a,b)=>score(b,profile)-score(a,profile) || a.id.localeCompare(b.id))
}
export function celebrationGreeting(event: Celebration, preferredName?: string): string {
  const name = preferredName?.trim()
  const address = name ? `, ${name}` : ''
  if (event.id === 'birthday') return `¡Feliz cumpleaños${address}!`
  if (event.tone === 'solemn') return `Hoy recordamos: ${event.label}.`
  if (event.tone === 'recognition') return `Hoy conmemoramos ${event.label}${address}.`
  return `¡Feliz ${event.label}${address}!`
}
export const CELEBRATION_ACCENTS: Record<CelebrationTheme, { icon:string; color:string; secondary:string }> = {
  patriotic:{icon:'✦',color:'#1664bc',secondary:'#d13b49'},
  family:{icon:'♥',color:'#d04a80',secondary:'#f6b8c9'},
  'new-year':{icon:'✧',color:'#c08b2f',secondary:'#efd18b'},
  winter:{icon:'✳',color:'#287c66',secondary:'#d94845'},
  spring:{icon:'❀',color:'#db8b39',secondary:'#f4d69e'},
  culture:{icon:'✧',color:'#9b7441',secondary:'#e7c995'},
  health:{icon:'✚',color:'#178d85',secondary:'#a0dcd7'},
  education:{icon:'✦',color:'#b28431',secondary:'#e3c688'},
  science:{icon:'✳',color:'#217fc4',secondary:'#9acbed'},
  environment:{icon:'❧',color:'#39854e',secondary:'#a5d8ac'},
  equality:{icon:'✿',color:'#9451ab',secondary:'#dbc2e6'},
  peace:{icon:'◌',color:'#588ca6',secondary:'#b5dae2'},
  autumn:{icon:'✦',color:'#c5782c',secondary:'#f1b778'},
  birthday:{icon:'✧',color:'#c48a37',secondary:'#fad88f'},
}
/**
 * Extend calendars with more than 200 countries through the public Nager v4
 * endpoint. No API key, no blocking render and no personal profile sent.
 * The external response is treated as untrusted and validated at ingress.
 */
const holidayCache = new Map<string, { at: number; events: Celebration[] }>()

export async function fetchCountryHolidays(year:number, country:string, signal?:AbortSignal):Promise<Celebration[]> {
  const code = normalizedCountry(country)
  if (!code || year < 1900 || year > 2100) return []
  const key = `${code}/${year}`
  const cached = holidayCache.get(key)
  if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) return cached.events
  const response = await fetch(`https://nagerholidays.com/api/v4/Holidays/${code}/${year}`, { signal })
  if (!response.ok) throw new Error(`Holidays API HTTP ${response.status}`)
  const raw: unknown = await response.json()
  if (!Array.isArray(raw)) throw new Error('Invalid holiday response')
  const out: Celebration[] = []
  for (const row of raw.slice(0,1000)) {
    if (!row || typeof row !== 'object') continue
    const data = row as Record<string,unknown>
    if (data.countryCode !== code || typeof data.date !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !data.date.startsWith(String(year))
      || typeof data.name !== 'string' || data.name.length > 160) continue
    const holidayTypes = Array.isArray(data.holidayTypes) ? data.holidayTypes : []
    if (!holidayTypes.some(type => ['Public','Observance','Bank','Optional','Authorities'].includes(String(type)))) continue
    const states = Array.isArray(data.subdivisionCodes)
      ? data.subdivisionCodes.filter((x):x is string=>typeof x==='string' && /^[A-Z]{2}-[A-Z0-9]{1,4}$/.test(x))
      : []
    out.push({id:`nager-${code}-${data.date}-${out.length}`,date:data.date,
      label:data.name.trim(),country:code,theme:'culture',tone:'recognition',source:'nager',
      ...(states.length?{stateCodes:states}:{}),priority:-25})
  }
  return out
}
