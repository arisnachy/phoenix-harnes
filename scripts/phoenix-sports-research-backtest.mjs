#!/usr/bin/env node
/** Offline sports research replay. No fresh game data, wagers or retrofitted picks.
 * Usage:
 * node --experimental-strip-types scripts/phoenix-sports-research-backtest.mjs --demo
 * node --experimental-strip-types scripts/phoenix-sports-research-backtest.mjs saved-ledger.json
 */
import {readFile} from 'node:fs/promises'
import {auditInjuryTimeline,auditCapturedBacktest}
  from '../packages/core/tool-sports/src/sports-pregame-research.ts'

const morning='2026-11-13T16:45:00Z',evening='2026-11-13T23:45:00Z'
const first='https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-13_11_45AM.pdf'
const second='https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-13_06_45PM.pdf'
const observations=[
  {team:'Indiana Pacers',athlete:'Aaron Nesmith',status:'Questionable',
    publishedAt:morning,url:first,important:true},
  {team:'Indiana Pacers',athlete:'Aaron Nesmith',status:'Available',
    publishedAt:evening,url:second,important:true},
  {team:'Chicago Bulls',athlete:'Norman Powell',status:'Questionable',
    publishedAt:morning,url:first,important:true},
  {team:'Chicago Bulls',athlete:'Norman Powell',status:'Questionable',
    publishedAt:evening,url:second,important:true},
]
const arg=process.argv[2]
if(!arg||arg==='--help'){
  console.log('Uso: node --experimental-strip-types scripts/phoenix-sports-research-backtest.mjs --demo | <captured-ledger.json>')
}else if(arg==='--demo'){
  const report=auditInjuryTimeline(observations,{
    decisionAt:'2026-11-13T23:50:00Z',
    kickoffAt:'2026-11-14T00:00:00Z',mode:'reconstruction'})
  console.log(JSON.stringify({kind:'research-reconstruction-not-prediction-backtest',
    fixtureDate:'2026-11-13',sources:[first,second],
    pregameTransitions:report,
    historicalTicket:{picks:5,wins:3,losses:2,hitRate:0.6,
      scope:'descriptive outcomes only; original model snapshots not available'},
    predictiveBacktest:auditCapturedBacktest([]),
  },null,2))
}else{
  const raw=await readFile(arg,'utf8')
  if(raw.length>10_000_000)throw Error('Ledger demasiado grande')
  const ledger=JSON.parse(raw)
  if(!Array.isArray(ledger)||ledger.length>500_000)
    throw Error('Ledger debe ser un array JSON de hasta 500000 registros')
  console.log(JSON.stringify({kind:'archived-pregame-backtest',
    source:arg,results:auditCapturedBacktest(ledger)},null,2))
}
