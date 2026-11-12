import {test} from 'node:test'
import assert from 'node:assert/strict'
import {boundedTicket,evidenceTicket} from '../src/evidence-ticket.ts'

const day='2026-10-28',now=Date.parse('2026-10-28T15:00:00Z')
const future='2026-10-28T23:00:00Z'
const base=(n,date,state,homeScore,awayScore,eventId=n)=>({
  id:String(eventId),date,status:{type:{state}},competitions:[{competitors:[
    {homeAway:'home',team:{id:String(n)+'1',displayName:'Home '+n},records:[{summary:'2-0'}],
      ...(homeScore===null?{}:{score:String(homeScore)})},
    {homeAway:'away',team:{id:String(n)+'2',displayName:'Away '+n},records:[{summary:'0-2'}],
      ...(awayScore===null?{}:{score:String(awayScore)})},
  ]}],
})
const fixture=(url,withHistory=true)=>{
  const key=String(url).match(/dates=([0-9]{6,8})/u)?.[1]
  if(!String(url).includes('/soccer/eng.1/'))return{events:[]}
  if(key==='20261028')return{events:Array.from({length:6},(_,i)=>base(100+i,future,'pre',null,null))}
  if(key==='202610'&&withHistory)return{events:
    ['20261027','20261026','20261025','20261024','20261023'].flatMap(day=>{
      const stamp='2026-'+day.slice(4,6)+'-'+day.slice(6,8)+'T21:00:00Z'
      return Array.from({length:6},(_,i)=>base(100+i,stamp,'post',3,0,
        100+i+Number(day.slice(-2))*1000))
    })}
  if(withHistory&&['20261027','20261026','20261025','20261024','20261023'].includes(key)){
    const stamp='2026-'+key.slice(4,6)+'-'+key.slice(6,8)+'T21:00:00Z'
    return{events:Array.from({length:6},(_,i)=>base(100+i,stamp,'post',3,0,100+i+Number(key.slice(-2))*1000))}
  }
  return{events:[]}
}
const mock=(history=true)=>async url=>new Response(JSON.stringify(fixture(url,history)),{status:200})
test('evidence-first automatic ticket returns exactly five sourced legs, no invented prices or probabilities',async()=>{
  const result=await evidenceTicket(5,day,'soccer',mock(),now)
  assert.equal(result.complete,true)
  assert.equal(result.verifiedEvents,5)
  assert.equal(result.card.props.legs.length,5)
  assert.equal(new Set(result.card.props.legs.map(x=>x.event)).size,5)
  assert.equal(result.priced,false)
  assert.equal(result.modelProbabilities,false)
  assert.equal(result.card.props.legs.length,5)
  assert.ok(result.card.props.legs.every(x=>x.legProbabilitySource==='exploratory-recent-form'))
  assert.ok(result.card.props.legs.every(x=>Number.isFinite(x.legWinProbabilityPercent)))
  assert.match(result.card.props.legs[0].rationale,/Probabilidad individual exploratoria/)
  assert.equal(result.card.props.combinedOdds,'No disponible')
})
test('auto ticket shows an honest 0/5 draft when historic games are unavailable',async()=>{
  const result=await evidenceTicket(5,day,'soccer',mock(false),now)
  assert.equal(result.complete,false)
  assert.equal(result.verifiedEvents,0)
  assert.equal(result.discoveryAudit.discoveredEvents,6)
  assert.equal(result.discoveryAudit.rejectedForEvidence,6)
  assert.match(result.card.props.subtitle,/Partidos descubiertos: 6/)
  assert.match(result.card.props.note,/Cero picks NO significa cero partidos/)
  assert.deepEqual(result.card.props.legs,[])
  assert.equal(result.card.props.requestedLegs,5)
  assert.equal(result.card.props.combinedOdds,'No disponible')
  assert.match(result.card.props.note,/TICKET INCOMPLETO/)
})
test('auto ticket rejects unsupported sports or leg counts',async()=>{
  await assert.rejects(()=>evidenceTicket(7,day,'soccer',mock(),now),/1 y 6/)
  await assert.rejects(()=>evidenceTicket(5,day,'unknown',mock(),now),/Filtro de deportes/)
})

test('six-leg ticket has six distinct upcoming ESPN events and no invented prices',async()=>{
  const result=await evidenceTicket(6,day,'soccer',mock(),now)
  assert.equal(result.complete,true)
  assert.equal(result.verifiedEvents,6)
  assert.equal(result.card.props.legs.length,6)
  assert.equal(new Set(result.selections.map(x=>x.eventId)).size,6)
  assert.equal(result.card.props.combinedOdds,'No disponible')
})
test('completed matches must have five different ESPN IDs for each non-NFL team',async()=>{
  const repeated=async url=>{
    const body=fixture(url,true)
    if(String(url).includes('/soccer/eng.1/') && !String(url).includes('dates=20261028')){
      for(const game of body.events)game.id='999'
    }
    return new Response(JSON.stringify(body),{status:200})
  }
  const result=await evidenceTicket(5,day,'soccer',repeated,now)
  assert.equal(result.complete,false)
  assert.equal(result.verifiedEvents,0)
})

test('five-leg automatic scout verifies ESPN summaries and injury coverage without fabricating lineups',async()=>{
  let summaryCalls=0,injuryCalls=0
  const reviewed=async url=>{
    const u=String(url)
    if(u.includes('/summary?event=')){
      summaryCalls++
      return new Response(JSON.stringify({header:{competitions:[{competitors:[]} ]}}))
    }
    if(u.endsWith('/injuries')){
      injuryCalls++
      return new Response(JSON.stringify({injuries:[]}))
    }
    return mock()(url)
  }
  const result=await evidenceTicket(5,day,'soccer',reviewed,now)
  assert.equal(summaryCalls,5)
  assert.ok(injuryCalls>=1)
  assert.equal(result.pregameSummariesVerified,5)
  assert.equal(result.injuryFeedsVerified,5)
  assert.equal(result.verifiedEvents,5)
  assert.match(result.card.props.note,/Accesible NO equivale a bajas o titulares verificados/)
  assert.match(result.card.props.legs[0].rationale,/titulares pendientes/)
})
test('three different games per team yield conditional research, not an automatic strong ticket',async()=>{
  const threeOnly=async url=>{
    const key=String(url).match(/dates=([0-9]{8})/u)?.[1]
    return new Response(JSON.stringify(fixture(url,
      ['20261028','20261027','20261026','20261025'].includes(key))))
  }
  const result=await evidenceTicket(5,day,'soccer',threeOnly,now)
  assert.equal(result.verifiedEvents,5)
  assert.ok(result.discoveryAudit.discoveredEvents>=5)
  assert.ok(result.card.props.legs.every(x=>/MUESTRA REDUCIDA/.test(x.rationale)))
  assert.ok(result.card.props.legs.every(x=>!/Probabilidad individual exploratoria/.test(x.rationale)))
  assert.equal(result.modelProbabilities,false)
})

test('a failed expert dossier is excluded before five-leg selection and replaced with the next real game',async()=>{
  const inspected=[]
  const result=await evidenceTicket(5,day,'soccer',mock(),now,process.env,async pool=>{
    inspected.push(...pool)
    assert.ok(pool.length>=6)
    return [{eventId:pool[0].eventId,excluded:true,priority:0,
      reason:'Contradicción entre participantes; excluir'}]
  })
  assert.equal(result.complete,true)
  assert.equal(result.verifiedEvents,5)
  assert.equal(result.card.props.legs.length,5)
  assert.equal(result.events.length,5)
  assert.ok(!result.events.some(x=>x.eventId===inspected[0].eventId))
  assert.ok(result.events.some(x=>x.eventId===inspected[5].eventId))
  assert.match(result.card.props.note,/descartados por contraindicación: 1/)
})
test('expert priority can replace weaker historical ranking before verifying the same five fixtures',async()=>{
  const inspected=[]
  const report=await evidenceTicket(5,day,'soccer',mock(),now,process.env,async pool=>{
    inspected.push(...pool)
    return [{eventId:pool[5].eventId,excluded:false,priority:1.5,
      reason:'Mejor expediente de lesiones, forma y titulares cotejado'}]
  })
  assert.equal(report.verifiedEvents,5)
  assert.ok(report.events.some(x=>x.eventId===inspected[5].eventId))
  assert.ok(report.selections.some(x=>/Revisión de alternativas/.test(x.rationale??'')))
})

test('a verified NBA/soccer fixture survives a later rotating or paginated ESPN scoreboard',async()=>{
  let dailyFetches=0
  const mutating=async url=>{
    const u=String(url)
    if(u.includes('/soccer/eng.1/scoreboard?dates=20261028')){
      dailyFetches++
      // Scout and research see the real slate. Later queries omit it.
      if(dailyFetches>2)return new Response(JSON.stringify({events:[]}),{status:200})
    }
    return mock()(url)
  }
  const result=await evidenceTicket(5,day,'soccer',mutating,now)
  assert.equal(result.complete,true)
  assert.equal(result.verifiedEvents,5)
  assert.equal(result.events.length,5)
  assert.equal(dailyFetches,2,
    'final rendering must reuse the exact timestamped provider-verified game IDs')
})

test('individual ESPN research stages cannot remain in Running forever',async()=>{
  const started=Date.now()
  await assert.rejects(()=>boundedTicket(new Promise(()=>{}),35),/Tiempo de investigación excedido/)
  assert.ok(Date.now()-started<500)
})

test('women Champions League enters automated ticket research after calendar discovery',async()=>{
  const requested=[]
  const womenOnly=async url=>{
    const raw=String(url);requested.push(raw)
    const source=raw.includes('/soccer/uefa.wchampions/')?
      fixture(raw.replace('/soccer/uefa.wchampions/','/soccer/eng.1/')):{events:[]}
    return new Response(JSON.stringify(source),{status:200})
  }
  const result=await evidenceTicket(5,day,'soccer',womenOnly,now)
  assert.ok(requested.some(url=>url.includes('/soccer/uefa.wchampions/')))
  assert.equal(result.verifiedEvents,5)
  assert.ok(result.events.every(x=>x.league==='uefa.wchampions'))
  assert.equal(result.priced,false)
  assert.equal(result.card.props.combinedOdds,'No disponible')
})

test('one verified historical game per rival never invents a winner',async()=>{
  const oneOnly=async url=>{
    const key=String(url).match(/dates=([0-9]{8})/u)?.[1]
    return new Response(JSON.stringify(fixture(url,
      ['20261028','20261027'].includes(key))))
  }
  const result=await evidenceTicket(5,day,'soccer',oneOnly,now)
  assert.equal(result.discoveryAudit.discoveredEvents,6)
  assert.equal(result.verifiedEvents,0)
  assert.equal(result.selections.length,0)
})


test('exact NBA+NHL day filter scans neither soccer nor unrelated sports',async()=>{
  const urls=[]
  const game=(id,day)=>({id,date:day+'T23:00:00Z',
    status:{type:{state:'pre'}},competitions:[{competitors:[
      {homeAway:'home',team:{id:'20',displayName:'Home Team'}},
      {homeAway:'away',team:{id:'28',displayName:'Away Team'}},
    ]}]})
  const fetcher=async url=>{
    const s=String(url);urls.push(s)
    const live=s.includes('dates=20261028')&&s.includes('/scoreboard')
    return new Response(JSON.stringify(live?{
      events:[game(s.includes('/hockey/')?'2000':'1000','2026-10-28')]
    }:{events:[]}),{status:200})
  }
  const r=await evidenceTicket(5,day,'basketball,hockey',fetcher,now,{})
  // Both NBA and WNBA are valid basketball leagues. This mock creates one
  // fixture in each plus NHL: three discovered events, not two.
  assert.equal(r.discoveryAudit.discoveredEvents,3)
  assert.equal(r.discoveryAudit.scanCoverage.filter(x=>x.sport==='nba').length,0)
  assert.ok(r.discoveryAudit.scanCoverage.every(x=>
    ['basketball','hockey'].includes(x.sport)))
  assert.ok(!urls.some(x=>x.includes('/soccer/')||x.includes('/baseball/')
    ||x.includes('/football/')||x.includes('/tennis/')))
  await assert.rejects(()=>evidenceTicket(5,day,
    'basketball,hockey,evil-source',fetcher,now,{}),/Filtro de deportes/)
})
