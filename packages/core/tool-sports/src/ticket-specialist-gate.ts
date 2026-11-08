/** Mandatory, sport-specific pregame dossier audit before any automated ticket is quoted.
 * A successful fetch is not proof of a starting lineup, calibrated edge, or permission
 * to describe a leg as approved. Absent/partial specialist research fails closed.
 */
import type {MarketOutcome} from './sports.ts'
import {investigateNfl} from './nfl-evidence-research.ts'
import {researchBasketballCase} from './basketball-evidence-dossier.ts'
import {investigateSoccer} from './soccer-worldwide-dossier.ts'
import {nhlSlate,investigateNhl} from './nhl-evidence-research.ts'
import {discoverMlbDay,researchMlbCase} from './mlb-evidence-research.ts'
import {tennisSlate,investigateTennis,type TennisTour} from './tennis-evidence-research.ts'

export type SpecialistFixture={
  sport:string;league:string;eventId:string;date:string;
  home:string;away:string;kickoff:string
}
export type SpecialistGate={
  sport:string;league:string;eventId:string;specialist:string;
  status:'researched'|'incomplete'|'unavailable'
  verifiedSteps:string[];pendingSteps:string[];
  /** No existing specialist currently supplies calibrated betting approval. */
  approvedForBetting:false;checkedAt:string
}
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const identities=(a:string,b:string,home:string,away:string)=>
  norm(a)===norm(home)&&norm(b)===norm(away)
const closeTime=(a:string,b:string)=>
  Number.isFinite(Date.parse(a))&&Number.isFinite(Date.parse(b))&&
  Math.abs(Date.parse(a)-Date.parse(b))<=90*60_000

/** Pure decision function, independently testable without providers. */
export function classifySpecialistCoverage(
  level:'A'|'B'|'C'|'D'|null,hasTeamEvidence:boolean,
  steps:readonly string[],pending:readonly string[],
):Pick<SpecialistGate,'status'|'verifiedSteps'|'pendingSteps'|'approvedForBetting'>{
  const reviewed=(level==='A'||level==='B')&&hasTeamEvidence&&steps.length>=2
  return{status:reviewed?'researched':'incomplete',
    verifiedSteps:[...steps],
    pendingSteps:reviewed?[...pending]:[
      'Investigación especializada insuficiente: se requiere expediente individual de ambos rivales',
      ...pending],
    approvedForBetting:false}
}
const errorResult=(game:SpecialistFixture,message:string):SpecialistGate=>({
  sport:game.sport,league:game.league,eventId:game.eventId,
  specialist:game.sport,status:'unavailable',verifiedSteps:[],
  pendingSteps:[message.slice(0,240)],approvedForBetting:false,
  checkedAt:new Date().toISOString(),
})

/** Run the real discipline-specific researcher for a previously verified ESPN fixture.
 * Official NHL/MLB IDs are resolved by BOTH teams and kickoff, never reused as ESPN IDs.
 */
export async function investigateTicketSpecialist(
  game:SpecialistFixture,fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,
  quotes:MarketOutcome[]=[],
):Promise<SpecialistGate>{
  const base={sport:game.sport,league:game.league,eventId:game.eventId}
  try{
    let specialist='',level:'A'|'B'|'C'|'D'|null=null
    let steps:string[]=[],pending:string[]=[],teams=false
    if(game.sport==='football'&&game.league==='nfl'){
      specialist='NFL: QB, 44 titulares, OL/pass rush, lesiones y clima'
      const d=await investigateNfl(game.date,game.eventId,fetcher,now,env,quotes)
      if(!identities(d.event.home.name,d.event.away.name,game.home,game.away))
        throw Error('NFL: equipos no coinciden con el partido cotizado')
      level=d.coverage.level
      teams=d.teams.home.roster.length>0&&d.teams.away.roster.length>0
      steps=['Rosters NFL '+d.coverage.verifiedPlayers+' jugadores',
        'Resultados recientes '+d.coverage.formGames+' observaciones',
        'Titulares confirmados '+(d.coverage.confirmedOffense+d.coverage.confirmedDefense)+'/44',
        'Enfrentamientos individuales '+d.matchups.length]
      pending=d.missingEvidence
    }else if(game.sport==='basketball'&&(game.league==='nba'||game.league==='wnba')){
      specialist='NBA/WNBA: jugadores, quintetos, eficiencia y bajas'
      const d=await researchBasketballCase(game.league,game.date,game.eventId,
        fetcher,now,env,quotes)
      if(!identities(d.fixture.home.name,d.fixture.away.name,game.home,game.away))
        throw Error('NBA/WNBA: equipos no coinciden con el partido cotizado')
      level=d.coverage.level
      teams=d.teams.home.roster.length>0&&d.teams.away.roster.length>0
      steps=['Jugadores en roster '+d.coverage.players,
        'Resultados recientes '+d.coverage.formGames,
        'Quintetos confirmados '+d.coverage.starters+'/10',
        'Eficiencia/pace verificados '+String(d.coverage.advancedMetrics)]
      pending=d.missingEvidence
    }else if(game.sport==='soccer'){
      specialist='Fútbol: once, xG, forma local/visita, lesiones y empate'
      const d=await investigateSoccer(game.date,game.league,game.eventId,
        fetcher,now,env,quotes)
      if(!identities(d.fixture.home.name,d.fixture.away.name,game.home,game.away))
        throw Error('Fútbol: equipos no coinciden con el partido cotizado')
      level=d.coverage.level
      teams=d.teams.home.roster.length>0&&d.teams.away.roster.length>0
      steps=['Jugadores disponibles '+d.coverage.players,
        'Resultados recientes '+d.coverage.recentGames,
        'Onces verificados '+String(d.coverage.lineups),
        'Enfrentamientos individuales '+d.duels.length]
      pending=d.missingEvidence
    }else if(game.sport==='hockey'&&game.league==='nhl'){
      specialist='NHL: porteros, forma, tiros y unidades especiales'
      const slate=await nhlSlate(game.date,fetcher,now)
      const match=slate.games.find(x=>identities(x.home.name,x.away.name,game.home,game.away)
        &&closeTime(x.date,game.kickoff))
      if(!match)throw Error('NHL: sin correspondencia oficial de ambos equipos y fecha')
      const d=await investigateNhl(game.date,match.id,fetcher,now,quotes)
      level=d.opportunity.decision==='investigate'?'B':'C'
      teams=d.players.home.length>0&&d.players.away.length>0
      steps=['Rosters '+(d.players.home.length+d.players.away.length),
        'Porteros candidatos '+(d.goalieCandidates.home.length+d.goalieCandidates.away.length),
        'Forma local/visita '+(d.form.home?.games??0)+'/'+(d.form.away?.games??0)]
      pending=d.missingEvidence
    }else if(game.sport==='baseball'&&game.league==='mlb'){
      specialist='MLB: abridores, bullpen, bateadores, clima y parque'
      const slate=await discoverMlbDay(game.date,fetcher,now)
      const match=slate.fixtures.find(x=>identities(x.home.name,x.away.name,game.home,game.away)
        &&closeTime(x.date,game.kickoff))
      if(!match)throw Error('MLB: sin correspondencia oficial de ambos equipos y fecha')
      const d=await researchMlbCase(game.date,match.gamePk,fetcher,now,env,quotes)
      level=d.opportunity.state==='investigate'?'B':'C'
      teams=d.rosters.home.length>0&&d.rosters.away.length>0
      steps=['Abridores '+Number(d.starters.home!==null&&d.starters.away!==null)+'/1 pareja',
        'Rosters '+(d.rosters.home.length+d.rosters.away.length),
        'Cruces bateador-lanzador '+d.matchups.length,
        'Escenarios por entradas '+d.scenarioAnalysis.length]
      pending=d.missingEvidence
    }else if(game.sport==='tennis'&&(game.league==='atp'||game.league==='wta')){
      specialist='Tenis: superficie, servicio/devolución, fatiga y H2H'
      const tour=game.league as TennisTour
      const slate=await tennisSlate(tour,game.date,fetcher,now,env)
      const match=slate.matches.find(x=>x.eventId===game.eventId&&
        closeTime(x.start,game.kickoff))
      if(!match)throw Error('Tenis: sin encuentro oficial equivalente')
      const d=await investigateTennis(tour,game.date,match.matchId,fetcher,now,env,quotes)
      level=d.coverage.level
      teams=d.players.every(x=>x.profileAvailable)
      steps=['Superficie verificada '+String(d.coverage.surfaceObserved),
        'Rankings verificados '+d.coverage.rankCount+'/2',
        'Servicio/devolución '+d.coverage.advancedStatsPlayers+'/2 jugadores']
      pending=d.missingEvidence
    }else return errorResult(game,'Sin especialista integrado para esta liga; no promover a ticket final')
    return{...base,specialist,...classifySpecialistCoverage(level,teams,steps,pending),
      checkedAt:new Date(now).toISOString()}
  }catch(error){
    return errorResult(game,(error instanceof Error?error.message:String(error)))
  }
}

/** Bound the expensive dossier calls and maintain exact event order. */
export async function investigateTicketSpecialists(
  games:readonly SpecialistFixture[],fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,
  quotes:MarketOutcome[]=[],
):Promise<SpecialistGate[]>{
  const audited:SpecialistGate[]=[]
  for(let offset=0;offset<games.length;offset+=2){
    const batch=await Promise.all(games.slice(offset,offset+2).map(game=>
      investigateTicketSpecialist(game,fetcher,now,env,quotes)))
    audited.push(...batch)
  }
  return audited
}
