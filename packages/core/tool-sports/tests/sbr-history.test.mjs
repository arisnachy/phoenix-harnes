import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { querySbrHistoricalOdds } from '../src/sbr-history.ts'

const sample = [
  { season: 2019, date: 20191117, home_team: 'New England Patriots', away_team: 'Philadelphia Eagles',
    home_close_ml: -135, away_close_ml: 120, home_open_spread: -3.5, home_close_spread: -4,
    open_over_under: 44.5, close_over_under: 42.5 },
  { season: 2019, date: 20190915, home_team: 'Dallas Cowboys', away_team: 'New York Giants',
    home_close_ml: '-180', away_close_ml: '+155', home_open_spread: -4, home_close_spread: -4.5,
    open_over_under: 48, close_over_under: 47.5 },
  { season: 2018, date: 20181117, home_team: 'Historical Home', away_team: 'Historical Away',
    home_close_ml: -105, away_close_ml: 100 },
  { season: 2019, date: 20190231, home_team: 'Invalid date', away_team: 'Visitor',
    home_close_ml: 9999999, away_close_ml: 0 },
  { season: 2019, date: 20190915, home_team: 'Missing opponent' },
]

test('SBR archive is explicitly historical and never a live bookmaker source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'phoenix-sbr-'))
  try {
    await writeFile(join(dir, 'nfl_archive_10Y.json'), JSON.stringify(sample))
    const result = await querySbrHistoricalOdds('nfl', 2019, '', 25, { PHOENIX_SBR_ARCHIVE_DIR: dir })
    assert.equal(result.totalMatches, 3)
    assert.equal(result.live, false)
    assert.equal(result.historical, true)
    assert.equal(result.fetchedFromLiveProvider, false)
    assert.equal(result.bookmaker, null)
    assert.equal(result.licensedForRedistribution, 'not_verified')
    assert.equal(result.items[0].date, '2019-11-17')
    assert.equal(result.items[0].homeClosingMoneyline, -135)
    assert.equal(result.items[0].openingTotal, 44.5)
    assert.equal(result.items[1].homeClosingMoneyline, -180)
    assert.equal(result.items[2].date, null)
    assert.equal(result.items[2].homeClosingMoneyline, null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('historical lookup filters teams and seasons and rejects present-day requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'phoenix-sbr-'))
  try {
    await writeFile(join(dir, 'nfl_archive_10Y.json'), JSON.stringify(sample))
    const res = await querySbrHistoricalOdds('nfl', 2019, 'giants', 10, { PHOENIX_SBR_ARCHIVE_DIR: dir })
    assert.equal(res.totalMatches, 1)
    assert.equal(res.items[0].home, 'Dallas Cowboys')
    await assert.rejects(() => querySbrHistoricalOdds('nfl', 2026, '', 10, { PHOENIX_SBR_ARCHIVE_DIR: dir }), /histórico/)
    await assert.rejects(() => querySbrHistoricalOdds('../private', 2019, '', 10, { PHOENIX_SBR_ARCHIVE_DIR: dir }), /inválido/)
    await assert.rejects(() => querySbrHistoricalOdds('nfl', 2019, '', 26, { PHOENIX_SBR_ARCHIVE_DIR: dir }), /Límite/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('operator must explicitly supply legal local archives', async () => {
  await assert.rejects(() => querySbrHistoricalOdds('mlb', 2019, '', 10, {}), /PHOENIX_SBR_ARCHIVE_DIR/)
})
