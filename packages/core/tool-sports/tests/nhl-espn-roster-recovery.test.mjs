import {test} from 'node:test'
import assert from 'node:assert/strict'
import {investigateNhl} from '../src/nhl-evidence-research.ts'
const date='2026-11-05',now=Date.parse('2026-11-02T11:00:00Z')
const game={id:2026020201,startTimeUTC:'2026-11-05T23:00:00Z',
  gameState:'FUT',season:20262027,homeTeam:{
    id:10,abbrev:'TOR',name:{default:'Toronto Maple Leafs'}},
  awayTeam:{id:20,abbrev:'MTL',name:{default:'Montreal Canadiens'}},
  venue:{default:'Arena'}}
const homeRoster={forwards:[{id:111,firstName:{default:'NHL'},
  lastName:{default:'Forward'}}],goalies:[{id:112,
  firstName:{default:'NHL'},lastName:{default:'Goalie'}}]}
test('NHL roster fallback resolves ESPN identities and never queries NHL player endpoint with ESPN IDs',async()=>{
  const urls=[]
  const fetcher=async input=>{const u=String(input);urls.push(u)
    if(u.endsWith('/v1/score/'+date))return new Response(JSON.stringify({games:[game]}))
    if(u.endsWith('/v1/roster/TOR/current'))
      return new Response(JSON.stringify(homeRoster))
    if(u.endsWith('/v1/roster/MTL/current'))
      return new Response('blocked',{status:503})
    if(u.includes('site.api.espn.com')&&u.includes('/scoreboard?dates=20261105')){
      return new Response(JSON.stringify({events:[{
        id:'8001',date:'2026-11-05T23:00:00Z',
        competitions:[{competitors:[
          {homeAway:'home',team:{id:'28',displayName:'Toronto Maple Leafs'}},
          {homeAway:'away',team:{id:'8',displayName:'Montreal Canadiens'}},
        ]}]}]}))
    }
    if(u.endsWith('/teams/8/roster')){
      return new Response(JSON.stringify({athletes:[
        {id:'999123',displayName:'ESPN Goalie',position:{abbreviation:'G'}},
        {id:'999124',displayName:'ESPN Skater',position:{abbreviation:'C'}},
      ]}))
    }
    return new Response(JSON.stringify({}))
  }
  const dossier=await investigateNhl(date,'2026020201',fetcher,now,[],3)
  assert.ok(dossier.players.away.length>=2)
  assert.ok(dossier.players.away.some(x=>x.id==='999123'&&x.role==='goalie'))
  assert.ok(dossier.players.away.every(x=>x.starterConfirmed===false))
  assert.ok(urls.some(x=>x.endsWith('/teams/8/roster')))
  assert.ok(urls.every(x=>!x.includes('/player/999123/landing')))
  assert.ok(dossier.missingEvidence.some(x=>x.includes('Rosters recuperados de ESPN')))
})
