import {test} from 'node:test'
import assert from 'node:assert/strict'
import {boundedPriced,evidencePricedTicket} from '../src/evidence-priced-ticket.ts'

const date='2026-10-28',now=Date.parse('2026-10-28T15:00:00Z')
const kick='2026-10-28T23:00:00Z'
const board=(url)=>{
  const day=String(url).match(/dates=([0-9]{6,8})/u)?.[1]
  if(!String(url).includes('/soccer/eng.1/'))return{events:[]}
  if(day==='202610')return{events:
    ['20261027','20261026','20261025','20261024','20261023'].flatMap(d=>
      Array.from({length:5},(_,i)=>({
        id:String(500+i+Number(d.slice(-2))*1000),
        date:'2026-'+d.slice(4,6)+'-'+d.slice(6,8)+'T21:00:00Z',
        status:{type:{state:'post'}},
        competitions:[{competitors:[
          {homeAway:'home',team:{id:String(i)+'1',displayName:'Home '+i},score:'3'},
          {homeAway:'away',team:{id:String(i)+'2',displayName:'Away '+i},score:'0'},
        ]}],
      })))
  }
  if(!['20261028','20261027','20261026','20261025','20261024','20261023'].includes(day))return{events:[]}
  const pre=day==='20261028'
  return{events:Array.from({length:5},(_,i)=>({
    id:String(500+i+(pre?0:Number(day.slice(-2))*1000)),date:pre?kick:'2026-'+day.slice(4,6)+'-'+day.slice(6,8)+'T21:00:00Z',
    status:{type:{state:pre?'pre':'post'}},competitions:[{competitors:[
      {homeAway:'home',team:{id:String(i)+'1',displayName:'Home '+i,logo:'https://a.espncdn.com/home-'+i+'.png'},...(!pre?{score:'3'}:{})},
      {homeAway:'away',team:{id:String(i)+'2',displayName:'Away '+i},...(!pre?{score:'0'}:{})},
    ]}],
  }))}}
const feed=async url=>new Response(JSON.stringify(board(url)),{status:200})
const mkQuotes=(alternating=false)=>async()=>{
  const out=[]
  for(let i=0;i<5;i++)out.push({
    eventId:'scraper-'+i,bookmaker:alternating&&i===4?'Book B':'Book A',
    market:'1x2',selection:'Home '+i,point:null,price:1.91,
    home:'Home '+i,away:'Away '+i,time:kick,updatedAt:'2026-10-28T14:30:00Z',
    sportKey:'football',source:'OddsHarvester/OddsPortal (sin API key)',
  })
  return out
}
const enabled={PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'1'}
// These deterministic fixtures supply only scoreboards. Inject verified specialist
// dossiers explicitly in PRICE-matching tests; production never uses this stub.
const stubSpecialists=async games=>games.map(g=>({
  sport:g.sport,league:g.league,eventId:g.eventId,
  specialist:'fixture specialist, test only',status:'researched',
  verifiedSteps:['both team rosters','form and injury audit'],
  pendingSteps:['independent model not calibrated'],approvedForBetting:false,
  checkedAt:new Date(now).toISOString(),
  checklist:{sport:g.sport,checkedAt:new Date(now).toISOString(),
    steps:[{key:'fixture',title:'Both teams and kickoff',critical:true,
      state:'verified',detail:'test fixture'}],verified:1,partial:0,missing:0,
    criticalPending:[],complete:true},
}))
const withSpecialists=(...args)=>{
  const [count,day,sport,stake,at,env,fetcher,quotesProvider,marketPreference]=args
  return evidencePricedTicket(count,day,sport,stake,at,env,fetcher,
    quotesProvider,marketPreference??'winner',stubSpecialists)
}
test('six-legged evidence path quotes only same bookmaker and preserves the requested stake',async()=>{
  // With five real fixtures and six requested legs, never invent the sixth.
  const draft=await withSpecialists(6,date,'soccer',100,now,enabled,feed,mkQuotes())
  assert.equal(draft.complete,false)
  assert.equal(draft.priced,false)
  assert.equal(draft.verifiedEvents,5)
  const complete=await withSpecialists(5,date,'soccer',100,now,enabled,feed,mkQuotes())
  assert.equal(complete.complete,true)
  assert.equal(complete.priced,true)
  assert.equal(complete.approvedLegs,0,'uncalibrated specialists cannot approve bets')
  assert.equal(complete.researchedLegs,5)
  assert.equal(complete.decisionAudit.legs.length,5)
  assert.ok(complete.decisionAudit.legs.every(x=>x.verdict==='hold'))
  assert.equal(complete.card.props.legs[0].decisionReview.verdict,'hold')
  assert.equal(complete.card.props.decisionAudit.approvedForBetting,false)
  assert.equal(complete.card.props.legs.length,5)
  assert.equal(complete.card.props.legs[0].legProbabilitySource,'exploratory-recent-form')
  assert.ok(Number.isFinite(complete.card.props.legs[0].legWinProbabilityPercent))
  assert.equal(complete.card.props.legs.length,5)
  assert.equal(complete.card.props.stake,'100.00')
  assert.equal(complete.card.props.requestedLegs,5)
  assert.match(complete.card.props.legs[0].homeLogo,/a\.espncdn\.com/)
  assert.match(complete.card.props.legs[0].rationale,/ESPN 5 partidos distintos/)
  assert.match(complete.card.props.note,/NO son probabilidades calibradas/)
  assert.equal(complete.placed,false)
  assert.equal(complete.missingQuotes,0)
})
test('does not combine prices from different bookmakers even when each leg was quoted',async()=>{
  const result=await withSpecialists(5,date,'soccer',100,now,enabled,feed,mkQuotes(true))
  assert.equal(result.priced,false)
  assert.equal(result.quotedLegs,5)
  assert.equal(result.missingQuotes,0)
  assert.match(result.explanation,/distintas casas/)
})

test('1X double chance uses real matching bookmaker market, keeps branding and rationale',async()=>{
  const markets=[]
  const quotes=async(sport,market)=>{
    markets.push([sport,market])
    return Array.from({length:5},(_,i)=>({
      eventId:'oddsportal-'+i,bookmaker:'Book A',market:'double_chance',
      selection:'1X',point:null,price:1.34,home:'Home '+i,away:'Away '+i,
      time:kick,updatedAt:'2026-10-28T14:30:00Z',
      sportKey:'football',source:'OddsHarvester/OddsPortal (sin API key)',
    }))
  }
  const result=await withSpecialists(5,date,'soccer',100,now,enabled,feed,quotes,'double_chance')
  assert.deepEqual(markets,[['football','double_chance']])
  assert.equal(result.complete,true)
  assert.equal(result.priced,true)
  assert.equal(result.card.props.legs.length,5)
  assert.equal(result.card.props.legs[0].selection,'1X · Local o empate')
  assert.equal(result.card.props.legs[0].market,'Doble oportunidad (1X/X2)')
  assert.equal(result.card.props.legs[0].price,'1.34')
  assert.equal(result.card.props.legs[0].legProbabilitySource,'unavailable')
  assert.equal(result.card.props.legs[0].legWinProbabilityPercent,null)
  assert.match(result.card.props.legs[0].rationale,/no estimable/i)
  assert.doesNotMatch(String(result.card.props.note),/Producto del mercado bajo independencia/)
  assert.equal(result.card.props.legs[0].bookmaker,'Book A')
  assert.match(result.card.props.legs[0].homeLogo,/^https:\/\/a\.espncdn\.com\//)
  assert.match(result.card.props.legs[0].rationale,/ESPN 5 partidos distintos/)
  assert.match(result.card.props.note,/NO asegura ganar/)
  assert.equal(result.placed,false)
})
test('1X/X2 never silently falls back to a direct winner or the wrong double chance',async()=>{
  const quotes=async(_sport,_market)=>Array.from({length:5},(_,i)=>({
    eventId:'oddsportal-'+i,bookmaker:'Book A',market:'1x2',selection:'Home '+i,
    point:null,price:1.91,home:'Home '+i,away:'Away '+i,
    time:kick,updatedAt:'2026-10-28T14:30:00Z',
    sportKey:'football',source:'OddsHarvester/OddsPortal (sin API key)',
  }))
  const wrongMarket=await withSpecialists(5,date,'soccer',100,now,enabled,feed,quotes,'double_chance')
  assert.equal(wrongMarket.priced,false)
  assert.equal(wrongMarket.quotedLegs,0)
  assert.equal(wrongMarket.card.props.combinedOdds,'No disponible')
  const wrongSide=await withSpecialists(5,date,'soccer',100,now,enabled,feed,
    async()=>Array.from({length:5},(_,i)=>({...{
      eventId:'oddsportal-'+i,bookmaker:'Book A',market:'double_chance',
      selection:'X2',point:null,price:1.4,home:'Home '+i,away:'Away '+i,
      time:kick,updatedAt:'2026-10-28T14:30:00Z',
      sportKey:'football',source:'OddsHarvester/OddsPortal (sin API key)',
    }})),'double_chance')
  assert.equal(wrongSide.priced,false)
  assert.equal(wrongSide.quotedLegs,0)
})
test('non-finite bookmaker prices are never used for a quoted ticket',async()=>{
  const bad=async()=>Array.from({length:5},(_,i)=>({
    eventId:'oddsportal-'+i,bookmaker:'Book A',market:'1x2',
    selection:'Home '+i,point:null,price:Number.NaN,home:'Home '+i,away:'Away '+i,
    time:kick,updatedAt:'2026-10-28T14:30:00Z',
    sportKey:'football',source:'OddsHarvester/OddsPortal (sin API key)',
  }))
  const result=await withSpecialists(5,date,'soccer',100,now,enabled,feed,bad)
  assert.equal(result.priced,false)
  assert.equal(result.quotedLegs,0)
})

test('six priced legs are six independently verified fixtures at one bookmaker',async()=>{
  const sixFeed=async url=>{
    const data=board(url)
    // The month archive must contain real results for the sixth club too.
    // Adding a future fixture alone cannot establish five historical games.
    if(String(url).includes('dates=202610')){
      for(const day of ['20261027','20261026','20261025','20261024','20261023']){
        data.events.push({
          id:String(90000+Number(day.slice(-2))),
          date:'2026-10-'+day.slice(-2)+'T21:00:00Z',
          status:{type:{state:'post'}},
          competitions:[{competitors:[
            {homeAway:'home',team:{id:'51',displayName:'Home 5'},score:'3'},
            {homeAway:'away',team:{id:'52',displayName:'Away 5'},score:'0'},
          ]}],
        })
      }
    }
    if(data.events.length){
      const added=structuredClone(data.events[4])
      added.id=String(Number(added.id)+1)
      added.competitions[0].competitors[0].team={id:'51',displayName:'Home 5',
        logo:'https://a.espncdn.com/home-5.png'}
      added.competitions[0].competitors[1].team={id:'52',displayName:'Away 5'}
      data.events.push(added)
    }
    return new Response(JSON.stringify(data),{status:200})
  }
  const quotes=async()=>Array.from({length:6},(_,i)=>({
    eventId:'oddsportal-'+i,bookmaker:'Book A',market:'1x2',
    selection:'Home '+i,point:null,price:1.91,home:'Home '+i,away:'Away '+i,
    time:kick,updatedAt:'2026-10-28T14:30:00Z',
    sportKey:'football',source:'OddsHarvester/OddsPortal (sin API key)',
  }))
  const result=await withSpecialists(6,date,'soccer',100,now,enabled,sixFeed,quotes)
  assert.equal(result.complete,true)
  assert.equal(result.priced,true)
  assert.equal(result.verifiedEvents,6)
  assert.equal(result.card.props.legs.length,6)
  assert.equal(new Set(result.card.props.legs.map(x=>x.event)).size,6)
  assert.equal(result.card.props.requestedLegs,6)
})
test('X2 quotes are accepted only when five-game form favors the away team',async()=>{
  const awayFeed=async url=>{
    const data=board(url)
    if(!String(url).includes('dates=20261028')){
      for(const event of data.events){
        event.competitions[0].competitors[0].score='0'
        event.competitions[0].competitors[1].score='3'
      }
    }
    return new Response(JSON.stringify(data),{status:200})
  }
  const quotes=async()=>Array.from({length:5},(_,i)=>({
    eventId:'oddsportal-'+i,bookmaker:'Book A',market:'double_chance',
    selection:'X2',point:null,price:1.36,home:'Home '+i,away:'Away '+i,
    time:kick,updatedAt:'2026-10-28T14:30:00Z',
    sportKey:'football',source:'OddsHarvester/OddsPortal (sin API key)',
  }))
  const result=await withSpecialists(5,date,'soccer',100,now,enabled,awayFeed,quotes,'double_chance')
  assert.equal(result.priced,true)
  assert.equal(result.card.props.legs.length,5)
  assert.equal(result.card.props.legs[0].selection,'X2 · Visita o empate')
  assert.equal(result.card.props.legs[0].price,'1.36')
})

test('automatic odds ticket uses the existing The Odds API adapter if keyless scraper is not enabled',async()=>{
  let apiCalls=0
  const withApi=async url=>{
    if(String(url).includes('api.the-odds-api.com')){
      apiCalls++
      return new Response(JSON.stringify(Array.from({length:5},(_,i)=>({
        id:'book-'+i,home_team:'Home '+i,away_team:'Away '+i,commence_time:kick,
        bookmakers:[{key:'a',title:'Book A',last_update:'2026-10-28T14:45:00Z',markets:[{
          key:'h2h',last_update:'2026-10-28T14:45:00Z',
          outcomes:[
            {name:'Home '+i,price:1.70},{name:'Away '+i,price:2.45},
            {name:'Draw',price:3.2},
          ],
        }]}],
      }))),{status:200})
    }
    return feed(url)
  }
  const result=await withSpecialists(5,date,'soccer',100,now,
    {THE_ODDS_API_KEY:'mock-secret'},withApi)
  assert.equal(apiCalls,1)
  assert.equal(result.priced,true)
  assert.equal(result.card.props.legs.length,5)
  assert.equal(result.card.props.legs[0].price,'1.7')
  assert.match(result.card.props.legs[0].rationale,/Resumen ESPN/)
  assert.equal(result.card.props.legs[0].bookmaker,'Book A')
})
test('soccer two-outcome API prices cannot be mislabeled 1X2 without a draw outcome',async()=>{
  const incomplete=async url=>{
    if(String(url).includes('api.the-odds-api.com'))return new Response(JSON.stringify(
      Array.from({length:5},(_,i)=>({
        id:'b-'+i,home_team:'Home '+i,away_team:'Away '+i,commence_time:kick,
        bookmakers:[{key:'a',title:'Book A',last_update:'2026-10-28T14:45:00Z',
          markets:[{key:'h2h',outcomes:[{name:'Home '+i,price:1.7}]}]}],
      }))))
    return feed(url)
  }
  const result=await withSpecialists(5,date,'soccer',100,now,
    {THE_ODDS_API_KEY:'mock-secret'},incomplete)
  assert.equal(result.priced,false)
  assert.equal(result.quotedLegs,0)
})
test('stale bookmaker quotes do not receive a fresh ticket label',async()=>{
  const stale=async url=>{
    if(String(url).includes('api.the-odds-api.com'))return new Response(JSON.stringify(
      Array.from({length:5},(_,i)=>({
        id:'b-'+i,home_team:'Home '+i,away_team:'Away '+i,commence_time:kick,
        bookmakers:[{key:'a',title:'Book A',last_update:'2026-10-27T10:00:00Z',
          markets:[{key:'h2h',outcomes:[{name:'Home '+i,price:1.7},{name:'Draw',price:3.2}]}]}],
      }))))
    return feed(url)
  }
  const result=await withSpecialists(5,date,'soccer',100,now,
    {THE_ODDS_API_KEY:'mock-secret'},stale)
  assert.equal(result.priced,false)
  assert.equal(result.missingQuotes,5)
})

test('a four-of-five slate still audits real provider prices and cannot be called a priced parlay',async()=>{
  const partialFeed=async url=>{
    const data=board(url)
    data.events=data.events.filter(e=>!String(e.id).endsWith('4'))
    return new Response(JSON.stringify(data),{status:200})
  }
  let quoteCalls=0
  const source=async()=>{
    quoteCalls++
    return Array.from({length:4},(_,i)=>({
      eventId:'scraper-'+i,bookmaker:'Book A',market:'1x2',
      selection:'Home '+i,point:null,price:1.91,
      home:'Home '+i,away:'Away '+i,time:kick,
      updatedAt:'2026-10-28T14:30:00Z',sportKey:'football',
      source:'OddsHarvester/OddsPortal (sin API key)',
    }))
  }
  const result=await withSpecialists(5,date,'soccer',100,now,enabled,partialFeed,source)
  assert.equal(result.complete,false)
  assert.equal(result.priced,false)
  assert.equal(result.approvedLegs,0)
  assert.equal(result.verifiedEvents,4)
  assert.equal(result.quotedLegs,4)
  assert.equal(result.missingQuotes,1)
  assert.equal(quoteCalls,1,'partial ticket must still query its candidate bookmaker markets')
  const harvester=result.sourceAudit.find(row=>row.source==='OddsHarvester')
  assert.equal(harvester.status,'observed')
  assert.equal(harvester.offers,4)
  assert.equal(result.card.props.combinedOdds,'No disponible')
  assert.match(result.card.props.note,/Cuotas cotejadas: 4\/5/)
  assert.match(result.explanation,/INCOMPLETO/)
})
test('disabled OddsHarvester is never described as queried with live prices',async()=>{
  const result=await withSpecialists(5,date,'soccer',100,now,{},feed)
  const source=result.sourceAudit.find(row=>row.source==='OddsHarvester')
  assert.equal(source.status,'disabled')
  assert.equal(source.offers,0)
  assert.equal(result.approvedLegs,0)
  assert.ok(!result.priced)
  assert.equal(result.card.props.combinedOdds,'No disponible')
})


test('missing specialist data creates a visible conditional ticket when ESPN and exact quotes agree',async()=>{
  const result=await evidencePricedTicket(5,date,'soccer',100,now,enabled,feed,mkQuotes())
  assert.equal(result.complete,true,'five real legs are present')
  assert.equal(result.priced,true,'real same-bookmaker prices can be displayed')
  assert.equal(result.conditional,true)
  assert.equal(result.dossierComplete,false)
  assert.equal(result.approvedLegs,0)
  assert.equal(result.specialistChecks.length,5)
  assert.ok(result.specialistChecks.some(x=>x.status!=='researched'))
  assert.ok(result.card.props.legs.every(x=>x.researchStatus==='conditional'))
  assert.match(result.card.props.subtitle,/TICKET CONDICIONAL/)
  assert.match(result.explanation,/TICKET CONDICIONAL/)
})
test('explicit team identity conflict still blocks attaching odds to the wrong fixture',async()=>{
  const wrongTeams=async games=>games.map(game=>({
    sport:game.sport,league:game.league,eventId:game.eventId,
    specialist:'fixture identity',status:'unavailable',
    verifiedSteps:[],pendingSteps:['equipos no coinciden con el partido cotizado'],
    approvedForBetting:false,checkedAt:new Date(now).toISOString(),
  }))
  const result=await evidencePricedTicket(5,date,'soccer',100,now,enabled,feed,
    mkQuotes(), 'winner',wrongTeams)
  assert.equal(result.priced,false)
  assert.equal(result.complete,false)
  assert.match(result.explanation,/CONFLICTIVO/)
})
test('one missing lineup remains conditional; four researched legs are retained',async()=>{
  const mostlyChecked=async games=>games.map((game,i)=>({
    sport:game.sport,league:game.league,eventId:game.eventId,
    specialist:'dossier',status:i===2?'incomplete':'researched',
    verifiedSteps:['form','roster'],pendingSteps:i===2?['starting XI not published']:[],
    approvedForBetting:false,checkedAt:new Date(now).toISOString(),
  }))
  const result=await evidencePricedTicket(5,date,'soccer',100,now,enabled,feed,
    mkQuotes(),'winner',mostlyChecked)
  assert.equal(result.priced,true)
  assert.equal(result.conditional,true)
  assert.equal(result.researchedLegs,4)
  // A specialist without a verified checklist is conditional, even if its
  // descriptive status says researched. No silently promoted candidates.
  assert.equal(result.card.props.legs.filter(x=>x.researchStatus==='conditional').length,5)
  assert.ok(result.card.props.legs.some(x=>x.pendingEvidence.includes('starting XI not published')))
  assert.equal(result.approvedLegs,0)
})


test('fresh ESPN odds without lastUpdated complete an observed same-bookmaker research ticket',async()=>{
  const read=async url=>{
    const raw=board(url)
    const u=String(url)
    if(u.includes('/scoreboard?dates=20261028')){
      raw.events=raw.events.map((e,i)=>({...e,competitions:e.competitions.map(c=>({
        ...c,id:e.id,
        odds:[{provider:{name:'ESPN Reference Book'},
          homeTeamOdds:{moneyLine:-130},awayTeamOdds:{moneyLine:115},
          drawOdds:240}],
      }))}))
    }
    return new Response(JSON.stringify(raw),{status:200})
  }
  const result=await evidencePricedTicket(5,date,'soccer',0,now,
    {PHOENIX_SPORTS_ESPN_DISABLED:'0',
      PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'0'},read,
    undefined,'winner',stubSpecialists)
  assert.equal(result.verifiedEvents,5)
  assert.equal(result.quotedLegs,5)
  assert.equal(result.priced,true)
  assert.equal(result.card.props.legs.length,5)
  assert.ok(Number(result.card.props.combinedOdds)>1)
  assert.ok(result.card.props.legs.every(x=>x.bookmaker==='ESPN Reference Book'))
  assert.match(result.card.props.subtitle,/precios observados en ESPN/)
  assert.match(result.card.props.note,/No se confirmó que la casa acepte ese precio/)
  assert.equal(result.placed,false)
})


test('five source-quoted legs remain CONDITIONAL when research checklist is incomplete',async()=>{
  const specialist=async games=>(await stubSpecialists(games)).map(s=>({
    ...s,checklist:{...s.checklist,verified:1,missing:1,
      criticalPending:['Two starting goalies or injury report'],complete:false},
  }))
  const result=await evidencePricedTicket(5,date,'soccer',100,now,enabled,feed,
    mkQuotes(),'winner',specialist)
  assert.equal(result.quotedLegs,5)
  assert.equal(result.priced,true)
  assert.equal(result.dossierComplete,false)
  assert.equal(result.conditional,true)
  assert.ok(result.card.props.legs.every(x=>x.researchStatus==='conditional'))
  assert.equal(result.approvedLegs,0)
})

test('optional quote sources have an independent finite deadline',async()=>{
  const started=Date.now()
  await assert.rejects(()=>boundedPriced(new Promise(()=>{}),35),/Fuente de cuotas: plazo agotado/)
  assert.ok(Date.now()-started<500)
})

test('partial 4/5 ticket recomputes market evidence and separate counts after quote fetch',async()=>{
  const four=async()=> (await mkQuotes()()).slice(0,4)
  const result=await withSpecialists(5,date,'soccer',0,now,enabled,feed,four)
  assert.equal(result.verifiedEvents,5)
  assert.equal(result.eventsFound,5)
  assert.equal(result.quotedLegs,4)
  assert.equal(result.approvedForBetting,false)
  assert.equal(result.priced,false)
  assert.equal(result.decisionAudit.legs.filter(x=>
    x.bookmakerBreakEvenPct!==null).length,4)
  assert.equal(result.decisionAudit.legs[4].bookmakerBreakEvenPct,null)
  assert.deepEqual(result.card.props.dataCounts,{
    eventsFound:5,quotedLegs:4,researchedLegs:5,
    conditionalLegs:5,approvedForBetting:0,
  })
  assert.deepEqual(result.card.props.decisionAudit,result.decisionAudit)
})

test('matched bookmaker price closes only the compact market step on second pass',async()=>{
  const partialMarket=async games=>(await stubSpecialists(games)).map(g=>({
    ...g,pendingSteps:['Pasos obligatorios sin cerrar (1): Cuota y mercado'],
    checklist:{...g.checklist,verified:1,partial:1,
      steps:[...g.checklist.steps,{key:'market',title:'Cuota y mercado',
        critical:true,state:'partial',detail:'Investigación anterior a cuotas',
        sources:['ESPN']}],
      criticalPending:['Cuota y mercado'],complete:false},
  }))
  const result=await evidencePricedTicket(5,date,'soccer',0,now,enabled,feed,
    mkQuotes(),'winner',partialMarket)
  assert.equal(result.quotedLegs,5)
  assert.equal(result.dossierComplete,true)
  assert.equal(result.eventsFound,5)
  assert.ok(result.specialistChecks.every(x=>x.checklist.steps.some(step=>
    step.key==='market'&&step.state==='verified')))
  assert.ok(result.specialistChecks.every(x=>
    x.checklist.criticalPending.length===0))
  assert.equal(result.card.props.dataCounts.quotedLegs,5)
  assert.equal(result.approvedLegs,0)
})
