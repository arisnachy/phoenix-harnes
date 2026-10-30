import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {saveResearchOdds,readResearchOdds} from '../src/sports-research-archive.ts'
const captured=Date.parse('2026-10-30T18:34:00.000Z')
const inputs=[
  {eventId:'401111111',home:'Boston Celtics',away:'Chicago Bulls',
    bookmaker:'DraftKings',market:'h2h',selection:'Boston Celtics',price:1.70,
    source:'ESPN Scoreboard',eventStartsAt:'2026-10-30T23:00:00Z'},
  {eventId:'401111111',home:'Boston Celtics',away:'Chicago Bulls',
    bookmaker:'DraftKings',market:'h2h',selection:'Chicago Bulls',price:2.20,
    source:'ESPN Scoreboard',eventStartsAt:'2026-10-30T23:00:00Z'},
]
test('private research archive stores ESPN quotes even with NO bookmaker timestamp, not as live',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'phoenix-archive-'))
  const env={PHOENIX_SPORTS_SOURCE_HOME:dir}
  try{
    const a=await saveResearchOdds('basketball_nba',inputs,env,captured)
    assert.deepEqual(a,{saved:true,count:2,disabled:false})
    const repeated=await saveResearchOdds('basketball_nba',inputs,env,captured+10_000)
    assert.equal(repeated.saved,false)
    const archive=await readResearchOdds('basketball_nba','2026-10-30','2026-10-30',undefined,env)
    assert.equal(archive.rows.length,2)
    assert.equal(archive.capturedFiles,1)
    assert.deepEqual(new Set(archive.rows.map(q=>q.sourceTimeStatus)),new Set(['missing']))
    assert.ok(archive.rows.every(q=>q.historical&&q.quoteIsCurrent===false&&!q.providerUpdatedAt))
    assert.ok(archive.rows.every(q=>q.observedAt==='2026-10-30T18:34:00.000Z'))
    assert.deepEqual((await readdir(join(dir,'research-odds','basketball_nba','2026-10-30'))).length,1)
    assert.equal((await readResearchOdds('basketball_nba','2026-10-30','2026-10-30','999',env)).rows.length,0)
  }finally{await rm(dir,{recursive:true,force:true})}
})
test('stored timestamp is never supplied by observation clock or treated as bookmaker time',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'phoenix-archive-'))
  const env={PHOENIX_SPORTS_SOURCE_HOME:dir}
  try{
    await saveResearchOdds('basketball_nba',[
      {...inputs[0],providerUpdatedAt:'2026-10-30T18:15:00Z'},
      {...inputs[1],providerUpdatedAt:'2100-01-01T00:00:00Z'},
    ],env,captured)
    const q=(await readResearchOdds('basketball_nba','2026-10-30','2026-10-30',undefined,env)).rows
    assert.equal(q.find(x=>x.selection==='Boston Celtics')?.providerUpdatedAt,'2026-10-30T18:15:00.000Z')
    assert.equal(q.find(x=>x.selection==='Chicago Bulls')?.providerUpdatedAt,undefined)
    assert.equal(q.find(x=>x.selection==='Chicago Bulls')?.sourceTimeStatus,'missing')
  }finally{await rm(dir,{recursive:true,force:true})}
})
test('archive opt-out, invalid event IDs, invalid date spans and unrelated source data rejected',async()=>{
  const env={PHOENIX_SPORTS_SOURCE_HOME:join(tmpdir(),'phoenix-never-created'),
    PHOENIX_SPORTS_RESEARCH_ARCHIVE_DISABLED:'1'}
  assert.equal((await saveResearchOdds('basketball_nba',inputs,env,captured)).disabled,true)
  await assert.rejects(()=>readResearchOdds('basketball_nba','2026-01-01','2026-10-30',undefined,env),/máximo 31/)
  const dir=await mkdtemp(join(tmpdir(),'phoenix-archive-'))
  try{
    const output=await saveResearchOdds('basketball_nba',[
      {...inputs[0],eventId:'../secrets'},
      {...inputs[1],source:'Unknown Outside Vendor'},
    ],{PHOENIX_SPORTS_SOURCE_HOME:dir},captured)
    assert.equal(output.saved,false)
    assert.equal(output.count,0)
  }finally{await rm(dir,{recursive:true,force:true})}
})
