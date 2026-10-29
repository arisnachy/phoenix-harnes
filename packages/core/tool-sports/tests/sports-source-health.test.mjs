import {test} from 'node:test'
import assert from 'node:assert/strict'
import {hydrateSportsSources,sportsSourcesHealth} from '../src/sports-source-health.ts'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

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

test('Kira automatically reads verified update manifest without manual environment copying',async()=>{
  const home=await mkdtemp(join(tmpdir(),'phoenix-sources-test-'))
  const bin=join(home,'.venv','bin','oddsharvester')
  const history=join(home,'history')
  try{
    await mkdir(join(home,'.venv','bin'),{recursive:true})
    await mkdir(history,{recursive:true})
    await writeFile(bin,'dummy CLI')
    await writeFile(join(history,'sportsbookreview-nhl.json'),'[{"test":true}]')
    await writeFile(join(home,'manifest.json'),JSON.stringify({
      schema:2,paths:{executable:bin,history},
      components:{
        'OddsHarvester + Playwright':{status:'installed'},
        'SportsbookReview NFL/NBA/NHL/MLB archive':{status:'installed'},
      },
    }))
    const env=hydrateSportsSources({PHOENIX_SPORTS_SOURCE_HOME:home})
    assert.equal(env.PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED,'1')
    assert.equal(env.PHOENIX_SPORTS_ODDSHARVESTER_BIN,bin)
    assert.equal(env.PHOENIX_SPORTS_HISTORY_DIR,history)
    const disabled=hydrateSportsSources({
      PHOENIX_SPORTS_SOURCE_HOME:home,PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'0',
    })
    assert.equal(disabled.PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED,'0')
  }finally{await rm(home,{recursive:true,force:true})}
})
