/** Actual PHOENIX NHL research over real network.
 * Uses a future game only. Never simulates current starter confirmations.
 * Run: node --experimental-strip-types scripts/phoenix-nhl-adapter-live-proof.mjs
 */
import {writeFile} from 'node:fs/promises'
import {nhlSlate,investigateNhl} from '../packages/core/tool-sports/src/nhl-evidence-research.ts'
const now=Date.now()
const specified=process.argv[2]
if(specified&&!/^\d{4}-\d{2}-\d{2}$/.test(specified))
  throw Error('Fecha NHL inválida')
const candidates=specified?[specified]:
  Array.from({length:8},(_,i)=>new Date(now+i*86_400_000).toISOString().slice(0,10))
const report={checkedAt:new Date(now).toISOString(),
  date:specified??null,scannedDates:[],stage:'not-run',event:null}
try{
  const prospective=[]
  for(const day of candidates){
    const slate=await nhlSlate(day,fetch,now)
    report.scannedDates.push({date:day,games:slate.games.length,
      sources:slate.sources.map(x=>({url:x.url,status:x.status}))})
    prospective.push(...slate.games.filter(x=>['FUT','PRE'].includes(x.state)&&
      Date.parse(x.date)>now+10_000).map(x=>({...x,slateDate:day})))
    if(prospective.length)break
  }
  if(!prospective.length){
    report.stage='no-future-game'
    report.reason='No future NHL game within the next seven calendar days; never replay postgame boxscores as pregame'
  }else{
    // Prefer an eventual late start so this test does not race the game clock.
    const fixture=prospective.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0]
    report.date=fixture.slateDate
    const d=await investigateNhl(fixture.slateDate,fixture.id,fetch,Date.now(),
      [],1,Date.now()+55_000)
    report.stage='investigated'
    report.event={id:fixture.id,home:fixture.home.name,away:fixture.away.name,
      kickoff:fixture.date}
    report.teams=Object.fromEntries(['home','away'].map(side=>{
      const players=d.players[side]
      const form=d.form[side]
      return[side,{
        rosterPlayers:players.length,
        goalies:players.filter(x=>x.role==='goalie').length,
        forwardPlayers:players.filter(x=>x.role==='forward').length,
        defensePlayers:players.filter(x=>x.role==='defense').length,
        sourceNamespace:Object.fromEntries(['NHL','ESPN'].map(p=>[
          p,players.filter(x=>x.idProvider===p).length])),
        recentGames:form?.games??0,
        last5:form?.last5.length??0,last10:form?.last10.length??0,
        last20:form?.last20.length??0,
        playersWithGameLogs:players.filter(x=>(x.last20?.length??0)>0).length,
        playersWithHomeSplits:players.filter(x=>x.homeRoadSplits?.home).length,
        playersWithAwaySplits:players.filter(x=>x.homeRoadSplits?.away).length,
        playerSamples:players.slice(0,2).map(p=>({
          name:p.name,role:p.role,idProvider:p.idProvider,
          stats:Object.keys(p.stats).length,last5:p.last5.length,
          last20:p.last20?.length??0,
          localSplitGames:p.homeRoadSplits?.home?.games??null,
          visitorSplitGames:p.homeRoadSplits?.away?.games??null,
          starterConfirmed:p.starterConfirmed}))
      }]
    }))
    report.sourceCoverage={
      observed:d.sources.filter(x=>x.status==='verified').length,
      missing:d.sources.filter(x=>x.status==='missing').length,
      errors:d.sources.filter(x=>x.status==='error').length,
      samples:d.sources.slice(0,25)
    }
    report.specialTeams=d.specialTeams
    report.officialShots=d.officialShots
    report.fiveOnFiveAudit=d.fiveOnFiveAudit
    report.fullRosterCoverage={
      home:{players:d.fullRosterAudit.home.count,
        withSeasonStats:d.fullRosterAudit.home.matchedStats,
        missingStats:d.fullRosterAudit.home.missingSeasonStats},
      away:{players:d.fullRosterAudit.away.count,
        withSeasonStats:d.fullRosterAudit.away.matchedStats,
        missingStats:d.fullRosterAudit.away.missingSeasonStats},
    }
    report.topSkaters=Object.fromEntries(['home','away'].map(side=>[
      side,d.skaterImpact[side].slice(0,5).map(p=>({
        id:p.playerId,name:p.name,points:p.points,goals:p.goals,
        assists:p.assists,gamesPlayed:p.gamesPlayed,
      })),
    ]))
    report.scorerCoverage={
      home:d.skaterImpact.home.length,away:d.skaterImpact.away.length,
      checkedAt:d.checkedAt,
    }
    report.goalieForms=Object.fromEntries(['home','away'].map(side=>[
      side,d.goalieCandidates[side].map(p=>({
        name:p.name,idProvider:p.idProvider,last20:p.last20?.length??0,
        savePctg:p.stats.savePctg??null})),
    ]))
    report.opportunity=d.opportunity
  }
}catch(e){
  report.stage='error'
  report.error=String(e?.stack??e).slice(0,1300)
}
await writeFile('phoenix-nhl-adapter-live-proof.json',JSON.stringify(report,null,2))
console.log('NHL_ADAPTER_LIVE_PROOF '+JSON.stringify(report).slice(0,14000))
if(process.env.PHOENIX_NHL_ADAPTER_PROOF_STRICT==='1'&&
  (report.stage==='error'||report.stage==='investigated'&&
    (!report.teams?.home?.rosterPlayers||!report.teams?.away?.rosterPlayers)))
  process.exitCode=1
