/**
 * Offline reader for independently obtained SportsbookReview historical exports.
 * Source project: https://github.com/flancast90/sportsbookreview-scraper (MIT code).
 * Its published datasets cover historical seasons, NOT live sportsbook offers.
 * Data redistribution/website rights must be assessed independently.
 */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const files = {
  nfl: 'nfl_archive_10Y.json',
  nba: 'nba_archive_10Y.json',
  mlb: 'mlb_archive_10Y.json',
  nhl: 'nhl_archive_10Y.json',
} as const
/** Sports supported by the publicly described SBR historical datasets. */
export type SbrSport = keyof typeof files

/** A historical game and its available archived pricing fields, never a current quote. */
export type SbrHistoricalGame = {
  season: number
  date: string | null
  home: string
  away: string
  homeClosingMoneyline: number | null
  awayClosingMoneyline: number | null
  homeOpeningSpread: number | null
  homeClosingSpread: number | null
  openingTotal: number | null
  closingTotal: number | null
}

/** Explicitly labelled archive result that cannot be mistaken for live bookmaker pricing. */
export type SbrHistoryResult = {
  sport: SbrSport
  season: number
  source: 'SportsbookReview historical archive'
  sourceRepository: string
  historical: true
  live: false
  bookmaker: null
  licensedForRedistribution: 'not_verified'
  fetchedFromLiveProvider: false
  totalMatches: number
  items: SbrHistoricalGame[]
  note: string
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const asName = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f]/gu, ' ').trim().slice(0, 110) : ''
const asFinite = (value: unknown): number | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (String(value).trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
const asMoneyline = (value: unknown): number | null => {
  const n = asFinite(value)
  return n !== null && Number.isInteger(n) && Math.abs(n) >= 100 && Math.abs(n) <= 100000 ? n : null
}
const asPoint = (value: unknown): number | null => {
  const n = asFinite(value)
  return n !== null && n >= -500 && n <= 500 ? n : null
}
const isoDate = (value: unknown): string | null => {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  if (!/^\d{8}$/u.test(raw)) return null
  const iso = raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6)
  const parsed = new Date(iso + 'T00:00:00Z')
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso
}
const normalize = (row: Record<string, unknown>, season: number): SbrHistoricalGame | null => {
  if (asFinite(row.season) !== season) return null
  const home = asName(row.home_team), away = asName(row.away_team)
  if (!home || !away) return null
  return {
    season,
    date: isoDate(row.date),
    home,
    away,
    homeClosingMoneyline: asMoneyline(row.home_close_ml),
    awayClosingMoneyline: asMoneyline(row.away_close_ml),
    homeOpeningSpread: asPoint(row.home_open_spread),
    homeClosingSpread: asPoint(row.home_close_spread),
    openingTotal: asPoint(row.open_over_under),
    closingTotal: asPoint(row.close_over_under),
  }
}

/**
 * Read an operator-supplied archive without downloading, scraping or exposing local paths.
 * @param sport - MLB, NBA, NFL or NHL key.
 * @param season - Historical season, 2007 through 2021.
 * @param team - Optional case-insensitive team filter.
 * @param limit - Maximum number of games to return.
 * @param env - Operator-controlled archive directory (no remote credentials needed).
 * @returns Source-attributed results explicitly flagged as historical and non-live.
 */
export async function querySbrHistoricalOdds(
  sport: string,
  season: number,
  team = '',
  limit = 10,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SbrHistoryResult> {
  if (!Object.hasOwn(files, sport)) throw new Error('Deporte histórico inválido: nfl, nba, mlb o nhl')
  if (!Number.isSafeInteger(season) || season < 2007 || season > 2021) {
    throw new Error('Este archivo SBR es histórico (temporadas hasta 2021), no contiene cuotas actuales')
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw new Error('Límite permitido: de 1 a 25 encuentros')
  if (typeof team !== 'string' || team.length > 100) throw new Error('Filtro de equipo inválido')
  const directory = env.PHOENIX_SBR_ARCHIVE_DIR
  if (!directory || !directory.trim()) {
    throw new Error('Archivo histórico no configurado: establecer PHOENIX_SBR_ARCHIVE_DIR con copias locales autorizadas de los archivos SBR')
  }
  const filename = files[sport as SbrSport]
  const file = join(directory, filename)
  const metadata = await stat(file)
  if (!metadata.isFile() || metadata.size > 25_000_000) throw new Error('Archivo SBR no válido o demasiado grande')
  const raw = await readFile(file, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed) || parsed.length > 500_000) throw new Error('Archivo histórico SBR mal formado')
  const search = team.trim().toLocaleLowerCase('en')
  const found: SbrHistoricalGame[] = []
  for (const entry of parsed) {
    if (!isObject(entry)) continue
    const game = normalize(entry, season)
    if (!game || (search && !game.home.toLocaleLowerCase('en').includes(search) && !game.away.toLocaleLowerCase('en').includes(search))) continue
    found.push(game)
  }
  found.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  return {
    sport: sport as SbrSport,
    season,
    source: 'SportsbookReview historical archive',
    sourceRepository: 'https://github.com/flancast90/sportsbookreview-scraper',
    historical: true,
    live: false,
    bookmaker: null,
    licensedForRedistribution: 'not_verified',
    fetchedFromLiveProvider: false,
    totalMatches: found.length,
    items: found.slice(0, limit),
    note: 'Investigación histórica únicamente. No son cuotas vigentes, no se conoce la casa específica y estas líneas nunca deben formar tickets actuales.',
  }
}
