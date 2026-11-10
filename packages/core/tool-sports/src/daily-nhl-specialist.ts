/** Match ESPN games to the separate official NHL game ID and inspect actual
 * goal margins, rest and goalie candidates before trusting a NHL spread.
 * A roster candidate is NEVER evidence of a confirmed starting goalie.
 */
import {nhlSlate,investigateNhl,type HockeyPlayer,type HockeyTeamForm} from './nhl-evidence-research.ts'

type TeamRisk={
  games:number;restHours:number|null;winsByTwo:number;lossesByTwo:number;
  margins:number[]
}
type GoalieCandidate={name:string;savePctg:string|null;goalsAgainstAvg:string|null}
export type DailyNhlSpecialist={
  status:'observed'|'unavailable';reason:string;officialGameId:string|null
  sourceCount:number;verifiedSources:number
  home:TeamRisk|null;away:TeamRisk|null
  homeGoalies:GoalieCandidate[];awayGoalies:GoalieCandidate[]
  confirmedStartingGoalies:false;calibratedCoverModel:false
  missingEvidence:string[]
}
const normalize=(name:string)=>name.normalize('NFD')
  .replace(/[\u0300-\u036f]/gu,'').toLowerCase().replace(/[^a-z0-9]/gu,'')
const teamRisk=(form:HockeyTeamForm|null):TeamRisk|null=>
  form?{games:form.games,restHours:form.restHours,
    winsByTwo:form.last10.filter(g=>g.goalsFor-g.goalsAgainst>=2).length,
    lossesByTwo:form.last10.filter(g=>g.goalsAgainst-g.goalsFor>=2).length,
    margins:form.last10.map(g=>g.goalsFor-g.goalsAgainst)}:null
const goalies=(players:HockeyPlayer[]):GoalieCandidate[]=>
  players.slice(0,4).map(p=>({name:p.name,
    savePctg:p.stats.savePctg??null,
    goalsAgainstAvg:p.stats.goalsAgainstAvg??null}))
const unavailable=(reason:string):DailyNhlSpecialist=>({
  status:'unavailable',reason,officialGameId:null,
  sourceCount:0,verifiedSources:0,home:null,away:null,
  homeGoalies:[],awayGoalies:[],confirmedStartingGoalies:false,
  calibratedCoverModel:false,missingEvidence:[reason],
})
/** Never derive a NHL gameId from an ESPN eventId. Join teams AND kickoff. */
export async function researchNhlOfficialMatch(
  input:{date:string;home:string;away:string;kickoff:string},
  fetcher:typeof fetch=fetch,now=Date.now(),
):Promise<DailyNhlSpecialist>{
  try{
    const slate=await nhlSlate(input.date,fetcher,now)
    const matches=slate.games.filter(game=>
      normalize(game.home.name)===normalize(input.home)&&
      normalize(game.away.name)===normalize(input.away)&&
      Math.abs(Date.parse(game.date)-Date.parse(input.kickoff))<=60*60_000)
    if(matches.length!==1)
      return unavailable('No se pudo cotejar un único gameId NHL oficial con equipos y horario ESPN')
    const dossier=await investigateNhl(input.date,matches[0]!.id,fetcher,now,[],3)
    if(dossier.fixture.id!==matches[0]!.id||
      normalize(dossier.fixture.home.name)!==normalize(input.home)||
      normalize(dossier.fixture.away.name)!==normalize(input.away)||
      Math.abs(Date.parse(dossier.fixture.date)-Date.parse(input.kickoff))>60*60_000)
      return unavailable('NHL gameId diferente del enfrentamiento solicitado: porteros descartados')
    return {status:'observed',reason:'Expediente NHL oficial; titulares NO confirmados',
      officialGameId:dossier.fixture.id,sourceCount:dossier.sources.length,
      verifiedSources:dossier.sources.filter(s=>s.status==='verified').length,
      home:teamRisk(dossier.form.home),away:teamRisk(dossier.form.away),
      homeGoalies:goalies(dossier.goalieCandidates.home),
      awayGoalies:goalies(dossier.goalieCandidates.away),
      confirmedStartingGoalies:false,calibratedCoverModel:false,
      missingEvidence:dossier.missingEvidence}
  }catch(error){
    return unavailable('Investigación NHL oficial no disponible: '+
      String(error instanceof Error?error.message:error).slice(0,180))
  }
}
