/** Actual PHOENIX NHL research over real network.
 * Uses a future game only. Never simulates current starter confirmations.
 * Run: node --experimental-strip-types scripts/phoenix-nhl-adapter-live-proof.mjs
 */
import {writeFile} from 'node:fs/promises'
import {nhlSlate,investigateNhl} from '../packages/core/tool-sports/src/nhl-evidence-research.ts'
const now=Date.now()
const date=process.argv[2]??'2026-11-12'
const report={checkedAt:new Date(now).toISOString(),date,stage:'not-run',event:null}
try{
  const slate=await nhlSlate(date,fetch,now)
  const prospective=slate.games.filter(x=>['FUT','PRE'].includes(x.state)&&
    Date.parse(x.date)>now+10_000)
  if(!prospective.length){
    report.stage='no-future-game'
    report.reason='No future game is available for real pregame adapter exercise'
  }else{
    // Prefer an eventual late start so this test does not race the game clock.
    const fixture=prospective.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0]
    const d=await investigateNhl(date,fixture.id,fetch,Date.now(),[],1)
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
