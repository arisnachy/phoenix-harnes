/** Evidence-based MLB team trend; it is not a calibrated win probability. */
import { getFeed } from './sports.ts'

type Standing = {
  team?: { id?: number }
  wins?: number
  losses?: number
  runsScored?: number
  runsAllowed?: number
}

type Standings = {
  records?: Array<{ teamRecords?: Standing[] }>
}

export type ResearchTrend = {
  favorite: string
  method: string
  source: string
  evidence: string[]
}

function validRecord(record: Standing): record is Standing & {
  wins: number
  losses: number
  runsScored: number
  runsAllowed: number
} {
  return Number.isSafeInteger(record.wins)
    && Number.isSafeInteger(record.losses)
    && typeof record.wins === 'number'
    && typeof record.losses === 'number'
    && record.wins >= 0
    && record.losses >= 0
    && record.wins + record.losses > 0
    && typeof record.runsScored === 'number'
    && typeof record.runsAllowed === 'number'
    && Number.isFinite(record.runsScored)
    && Number.isFinite(record.runsAllowed)
    && record.runsScored >= 0
    && record.runsAllowed >= 0
}

/** Compare published season records without inventing unavailable data. */
export async function researchMlbTrend(
  homeId: number,
  awayId: number,
  season: number,
  homeName: string,
  awayName: string,
  fetcher: typeof fetch = fetch,
): Promise<ResearchTrend | undefined> {
  if (!Number.isSafeInteger(homeId) || !Number.isSafeInteger(awayId)
    || homeId < 1 || awayId < 1 || homeId === awayId) return undefined
  if (!Number.isSafeInteger(season) || season < 1871 || season > 2100) return undefined

  try {
    const feed = await getFeed<Standings>(
      'https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=' + String(season),
      fetcher,
    )
    if (!Array.isArray(feed.records)) return undefined
    const records = feed.records.flatMap(item => Array.isArray(item.teamRecords) ? item.teamRecords : [])
    const home = records.find(item => item.team?.id === homeId)
    const away = records.find(item => item.team?.id === awayId)
    if (!home || !away || !validRecord(home) || !validRecord(away)) return undefined

    const homeWinRate = home.wins / (home.wins + home.losses)
    const awayWinRate = away.wins / (away.wins + away.losses)
    const homeRuns = home.runsScored - home.runsAllowed
    const awayRuns = away.runsScored - away.runsAllowed
    const winAdvantage = homeWinRate - awayWinRate
    const runAdvantage = homeRuns - awayRuns

    const favorite = winAdvantage > 0.04 && runAdvantage > 25
      ? homeName
      : winAdvantage < -0.04 && runAdvantage < -25
        ? awayName
        : 'Sin favorito consistente'

    return {
      favorite,
      method: 'Tendencia orientativa de Phoenix por temporada regular; no es una predicción calibrada ni un porcentaje de victoria.',
      evidence: [
        `${homeName}: ${home.wins}-${home.losses} · diferencial de carreras ${homeRuns > 0 ? '+' : ''}${homeRuns}`,
        `${awayName}: ${away.wins}-${away.losses} · diferencial de carreras ${awayRuns > 0 ? '+' : ''}${awayRuns}`,
      ],
      source: 'MLB Stats API · clasificación de ' + String(season),
    }
  } catch {
    return undefined
  }
}
