import {test} from 'node:test'
import assert from 'node:assert/strict'
import {auditUniversalMatchup} from '../src/universal-matchup-factors.ts'

const root='https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/'
const now=Date.parse('2026-10-29T14:00:00Z')
const lines=n=>Array.from({length:9},(_,i)=>({value:i<n?1:0}))
const row=(home,away,scoreH,scoreA)=>[
  {homeAway:'home',team:{id:home,displayName:home==='10'?'Home':'Away'},
    score:String(scoreH),linescores:lines(scoreH)},
  {homeAway:'away',team:{id:away,displayName:away==='20'?'Away':'Home'},
    score:String(scoreA),linescores:lines(scoreA)},
]
const fixture={
  id:'999',date:'2026-10-29T23:00:00Z',status:{type:{state:'pre'}},
  competitions:[{venue:{id:'505',fullName:'Verified Stadium',location:{latitude:40.8,longitude:-73.9}},
    competitors:row('10','20',0,0)}],
}
const old=Array.from({length:4},(_,i)=>({
  id:String(101+i),date:'2026-10-'+String(27-2*i).padStart(2,'0')+'T23:00:00Z',
  status:{type:{state:'post'}},
  competitions:[{venue:{id:'505',fullName:'Verified Stadium'},
    competitors:row(i%2?'20':'10',i%2?'10':'20',3,2)}],
}))
function factory(opts={}){
  const urls=[]
  const fetcher=async url=>{
    const u=String(url);urls.push(u)
    let body={}
    if(u===root+'scoreboard?dates=20261029')body={events:opts.unknown?[]:[fixture]}
    else if(u.includes('/scoreboard?dates='))body={events:opts.emptyHistory?[]:old.map(g=>
      opts.noInnings?{...g,competitions:[{...g.competitions[0],
        competitors:g.competitions[0].competitors.map(c=>({...c,linescores:[]}))}]}:g)}
    else if(u===root+'summary?event=999')body={header:{competitions:[{
      date:fixture.date,competitors:fixture.competitions[0].competitors} ]}}
    else if(u.includes('/teams/10/roster'))body={athletes:[{displayName:'Player Home'}]}
    else if(u.includes('/teams/20/roster'))body={athletes:[{displayName:'Player Away'}]}
    else if(u.endsWith('/news?limit=30'))body={articles:[
      {headline:'Home lineup review ahead of Away game',published:'2026-10-29T10:00:00Z'}]}
    else if(u.endsWith('/injuries'))body={injuries:[]}
    else if(u.startsWith('https://statsapi.mlb.com/api/v1/schedule'))body={dates:[{games:[{
      teams:{home:{team:{name:'Home'},probablePitcher:{id:801,fullName:'Pitcher One'}},
        away:{team:{name:'Away'},probablePitcher:{id:802,fullName:'Pitcher Two'}}},
    }]}]}
    else if(u.startsWith('https://api.open-meteo.com/'))
      body={hourly:{time:['2026-10-29T23:00'],
        temperature_2m:[18],wind_speed_10m:[14],wind_direction_10m:[270],
        is_day:[0],precipitation_probability:[15]}}
    else if(u.includes('/people/801/stats')||u.includes('/people/802/stats'))
      body={stats:[{splits:[{date:'2026-10-26',
        stat:{gamesStarted:1,earnedRuns:1,inningsPitched:'6.0',strikeOuts:8}},
        {date:'2026-10-19',stat:{gamesStarted:1,earnedRuns:3,
          inningsPitched:'5.0',strikeOuts:4}}]}]}
    return new Response(JSON.stringify(body),{status:200})
  }
  return {fetcher,urls}
}
const input={sport:'baseball',league:'mlb',eventId:'999',date:'2026-10-29',lookbackDays:14,includeOdds:false}
test('verifies H2H, stadium, 3/5/9 inning descriptive means and pitchers without assigning win chance',async()=>{
  const {fetcher,urls}=factory()
  const report=await auditUniversalMatchup(input,fetcher,now,{})
  assert.equal(report.home.id,'10')
  assert.equal(report.away.id,'20')
  assert.equal(report.headToHead.length,4)
  assert.equal(report.home.form.games,4)
  assert.equal(report.stadium.homeAtVenue,4)
  assert.equal(report.mlb.innings.length,3)
  assert.equal(report.mlb.innings[0].exploratoryTotal,5)
  assert.equal(report.mlb.innings[1].exploratoryTotal,5)
  assert.equal(report.mlb.innings[2].exploratoryTotal,5)
  assert.equal(report.mlb.probableStarters.length,2)
  assert.equal(report.mlb.probableStarters[0].outings.length,2)
  assert.equal(report.predictionCalibrated,false)
  assert.equal(report.marketComparisons.length,0)
  assert.equal(report.weather?.windKmh,14)
  assert.equal(report.weather?.dayNight,'Noche')
  assert.equal(report.uiBlock.component,'sports_espn_dashboard')
  assert.ok(report.uiBlock.props.sections.some(s=>s.heading.includes('innings')))
  assert.ok(report.limitations.some(s=>s.includes('calibrado')))
  assert.equal(urls.filter(url=>url.startsWith('https://api.open-meteo.com/')).length,1)
  assert.ok(urls.every(url=>url.startsWith(root)||url.startsWith('https://statsapi.mlb.com/')||url.startsWith('https://api.open-meteo.com/')))
})
test('does not produce projections from scoreboard records without inning splits',async()=>{
  const report=await auditUniversalMatchup(input,factory({noInnings:true}).fetcher,now,{})
  assert.equal(report.mlb.innings.every(p=>p.exploratoryTotal===null),true)
  assert.ok(report.limitations.some(s=>s.includes('3/5/9')))
})
test('rejects unknown ESPN event, fabricated IDs and invalid league',async()=>{
  await assert.rejects(auditUniversalMatchup({...input,eventId:'NaN'},factory().fetcher,now,{}),/inválidos/)
  await assert.rejects(auditUniversalMatchup({...input,league:'mlb/../nba'},factory().fetcher,now,{}),/inválidos/)
  await assert.rejects(auditUniversalMatchup(input,factory({unknown:true}).fetcher,now,{}),/no coincide/)
})
test('reports uncertainty and no fake odds when historic data are unavailable',async()=>{
  const report=await auditUniversalMatchup(input,factory({emptyHistory:true}).fetcher,now,{})
  assert.equal(report.home.form.games,0)
  assert.equal(report.headToHead.length,0)
  assert.ok(report.mlb.innings.every(p=>p.exploratoryTotal===null))
  assert.ok(report.limitations.some(s=>s.includes('Muestra inferior')))
  assert.equal(report.marketComparisons.length,0)
})
test('generic non-MLB sport skips MLB pitcher and inning assumptions',async()=>{
  const {fetcher:base}=factory()
  const adapter=async url=>{
    const u=String(url)
    if(u.includes('/basketball/nba/scoreboard')){
      if(u.includes('20261029'))return new Response(JSON.stringify({events:[{
        ...fixture,competitions:[{venue:{id:'505',fullName:'Arena'},
          competitors:fixture.competitions[0].competitors}]}]}),{status:200})
      return new Response(JSON.stringify({events:old}),{status:200})
    }
    if(u.includes('/basketball/nba/'))return new Response('{}',{status:200})
    return base(url)
  }
  const report=await auditUniversalMatchup({...input,sport:'basketball',league:'nba'},
    adapter,now,{})
  assert.equal(report.mlb.innings.length,0)
  assert.equal(report.mlb.probableStarters.length,0)
  assert.equal(report.headToHead.length,4)
})
