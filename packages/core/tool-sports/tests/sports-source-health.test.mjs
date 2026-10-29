import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sportsSourcesHealth} from '../src/sports-source-health.ts'

const find=(rows,name)=>rows.find(row=>row.provider===name)
test('source-health never claims configured scraper is collecting prices without a local binary',async()=>{
  const rows=await sportsSourcesHealth(
    {PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'1',PHOENIX_SPORTS_ODDSHARVESTER_BIN:'test-bin'},
    async bin=>{assert.equal(bin,'test-bin');return false},
    async()=>false,
  )
  assert.equal(find(rows,'jordantete/OddsHarvester').status,'missing-binary')
  assert.equal(find(rows,'flancast90/sportsbookreview-scraper').status,'not-configured')
  assert.equal(find(rows,'ArnavSaraogi/mlb-odds-scraper').purpose,'historical-odds')
  assert.equal(find(rows,'The Odds API v4').status,'not-configured')
  assert.equal(find(rows,'TheOddsAPI').status,'not-configured')
})
test('configured source, historical archive and different odds API keys are distinguished',async()=>{
  const files=[]
  const rows=await sportsSourcesHealth({
    PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'1',
    THE_ODDS_API_KEY:'secret1',THEODDSAPI_API_KEY:'secret2',
    PHOENIX_SPORTS_HISTORY_DIR:'/archive',
  },async()=>true,async filename=>{files.push(filename);return filename.endsWith('sportsbookreview-nhl.json')})
  assert.equal(find(rows,'jordantete/OddsHarvester').status,'configured')
  assert.equal(find(rows,'flancast90/sportsbookreview-scraper').status,'configured')
  assert.equal(find(rows,'ArnavSaraogi/mlb-odds-scraper').status,'missing-files')
  assert.equal(find(rows,'The Odds API v4').status,'configured')
  assert.equal(find(rows,'TheOddsAPI').status,'configured')
  const serialized=JSON.stringify(rows)
  assert.ok(!serialized.includes('secret1')&&!serialized.includes('secret2'))
  assert.equal(files.length,5)
})
test('disabled scraper is not probed or described as a live odds provider',async()=>{
  const rows=await sportsSourcesHealth({},async()=>{throw Error('should not run')},async()=>false)
  assert.equal(find(rows,'jordantete/OddsHarvester').status,'disabled')
  assert.match(find(rows,'jordantete/OddsHarvester').note,/NO se ejecutó/)
})
