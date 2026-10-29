import {test} from 'node:test'
import assert from 'node:assert/strict'
import {exploreEspn} from '../src/espn-intelligence.ts'

const mock=(handler)=>{
  const urls=[]
  return {urls,fetcher:async url=>{
    const u=String(url);urls.push(u)
    const response=handler(u)
    return new Response(JSON.stringify(response??{}),{status:200})
  }}
}
test('team explorer produces responsive cards with only actual roster, news, logo and schedule',async()=>{
  const {urls,fetcher}=mock(u=>{
    if(u.includes('/teams/456/roster'))return{athletes:[
      {items:[{displayName:'Verified Player A',position:{displayName:'Guard'},
        headshot:{href:'https://a.espncdn.com/i/headshots/nba/players/full/1.png'}}]},
    ]}
    if(u.includes('/teams/456/schedule'))return{events:[{name:'City A vs City B',date:'2026-11-02'}]}
    if(u.includes('/teams/456/news'))return{articles:[{headline:'City A injury update',
      published:'2026-10-29',description:'Roster update'}]}
    if(u.includes('/teams/456'))return{team:{displayName:'City A',abbreviation:'A',
      logos:[{href:'https://a.espncdn.com/i/teamlogos/nba/500/a.png'}]}}
    return{}
  })
  const data=await exploreEspn({sport:'basketball',league:'nba',view:'team',teamId:'456'},fetcher,{},Date.parse('2026-10-29'))
  assert.equal(data.title,'City A')
  assert.ok(data.uiBlock.props.image?.includes('espncdn'))
  assert.equal(data.uiBlock.component,'sports_espn_dashboard')
  assert.ok(data.sections.some(s=>s.heading==='Plantilla verificada'&&s.items[0].label==='Verified Player A'))
  assert.ok(data.sections.some(s=>s.heading==='Noticias del equipo'&&s.items[0].label==='City A injury update'))
  assert.equal(urls.length,4)
  assert.equal(data.sources.filter(s=>s.status==='available').length,4)
})
test('player explorer handles statistics, gamelog and splits as distinct sections',async()=>{
  const {fetcher}=mock(u=>{
    if(u.endsWith('/athletes/990'))return{displayName:'Athlete Real',age:31,
      headshot:{href:'https://a.espncdn.com/i/headshots/nba/players/full/990.png'}}
    if(u.includes('/athletes/990/stats'))return{categories:[{stats:[
      {name:'pointsPerGame',displayName:'Puntos/partido',displayValue:'28.2'},
    ]}]}
    if(u.includes('/athletes/990/gamelog'))return{
      events:{'150':{name:'A at B',date:'2026-10-27'}},
      seasonTypes:[{categories:[{labels:['PTS','REB'],events:[{eventId:'150',stats:['32','7']}]}]}],
    }
    if(u.includes('/athletes/990/splits'))return{categories:[{stats:[
      {name:'home',displayName:'Local',displayValue:'31.5'},
    ]}]}
    return{athlete:{displayName:'Athlete Real'}}
  })
  const x=await exploreEspn({sport:'basketball',league:'nba',view:'player',athleteId:'990'},fetcher)
  assert.equal(x.title,'Athlete Real')
  assert.ok(x.sections.some(s=>s.heading==='Estadísticas de temporada'&&
    s.items.some(i=>i.label==='Puntos/partido'&&i.value==='28.2')))
  assert.ok(x.sections.some(s=>s.heading==='Registro partido por partido'&&
    s.items.some(i=>i.value?.includes('PTS: 32'))))
  assert.ok(x.sections.some(s=>s.heading.includes('Splits')&&s.items.some(i=>i.value==='31.5')))
})
test('standings nested conferences do not lose team images or records',async()=>{
  const {fetcher}=mock(()=>({children:[{standings:{entries:[
    {team:{displayName:'Team X',logos:[{href:'https://a.espncdn.com/i/team.png'}]},
      stats:[{name:'overall',displayValue:'8-2'},{name:'wins',displayValue:'8'}]},
  ]}}]}))
  const d=await exploreEspn({sport:'hockey',league:'nhl',view:'standings'},fetcher)
  assert.equal(d.sections[0].items[0].value,'8-2')
  assert.ok(d.sections[0].items[0].image?.includes('espncdn'))
})
test('odds references and empty 200 are not published as prices or facts',async()=>{
  const {fetcher}=mock(u=>u.includes('/odds')?{items:[{$ref:'https://some.provider/offer'}]}:{})
  const d=await exploreEspn({sport:'hockey',league:'nhl',view:'event',eventId:'123'},fetcher)
  assert.equal(d.sources.filter(x=>x.status==='available').length,0)
  assert.ok(!d.sections.some(s=>s.heading.includes('Cuotas publicadas')))
  assert.ok(d.sections.some(s=>s.heading==='Disponibilidad'))
})
test('validation rejects injected segments and disables transport before HTTP',async()=>{
  let calls=0
  const fetcher=async()=>{calls++;return new Response('{}')}
  for(const input of [
    {sport:'hockey',league:'nhl',view:'team',teamId:'12/odds'},
    {sport:'hockey',league:'nhl',view:'player',athleteId:'12?admin=1'},
    {sport:'hockey',league:'nhl',view:'event',eventId:'../../test'},
    {sport:'basketball',league:'nba',view:'search',query:'a'},
    {sport:'basketball',league:'../../x',view:'news'},
  ])await assert.rejects(()=>exploreEspn(input,fetcher))
  await assert.rejects(()=>exploreEspn(
    {sport:'hockey',league:'nhl',view:'news'},fetcher,{PHOENIX_SPORTS_ESPN_DISABLED:'1'}))
  assert.equal(calls,0)
})
