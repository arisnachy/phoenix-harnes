/** Mandatory, sport-specific pregame dossier audit before any automated ticket is quoted.
 * A successful fetch is not proof of a starting lineup, calibrated edge, or permission
 * to describe a leg as approved. Absent/partial specialist research fails closed.
 */
import type {MarketOutcome} from './sports.ts'
import {crosscheckFreeFixture,type BackupFinding} from './free-sports-source-audit.ts'
import {auditSportChecklist,type SportChecklist,type StepObservation} from './daily-specialist-checklist.ts'
import {fetchEspnInjuryBackup,type InjuryBackup} from './espn-injury-backup.ts'
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
  /** Mandatory per-sport steps; an API response is not a completed step. */
  checklist?:SportChecklist
  /** Secondary fixtures are not bookmaker offers or confirmed starters. */
  sourceChecks?:BackupFinding[]
  /** Snapshot of both teams' reported availability; source freshness does not
   * establish starter confirmation or an official pre-tipoff inactive list. */
  injuryAudit?:InjuryBackup
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
  const eligible=game.sport==='soccer'||game.sport==='football'&&game.league==='nfl'
    ||game.sport==='basketball'&&['nba','wnba'].includes(game.league)
    ||game.sport==='hockey'&&game.league==='nhl'
    ||game.sport==='baseball'&&game.league==='mlb'
    ||game.sport==='tennis'&&['atp','wta'].includes(game.league)
  // Source verification overlaps the specialist: no serial network waterfall.
  // Failures are isolated; absence in a small feed cannot negate an ESPN game.
  const sourceTask:Promise<BackupFinding[]>=eligible
    ?crosscheckFreeFixture(game,fetcher,now,env).catch(()=>[] as BackupFinding[])
    :Promise.resolve([])
  const signals:Record<string,StepObservation>={}
  let injuryAudit:InjuryBackup|undefined
  const mark=(key:string,state:StepObservation['state'],detail:string)=>{
    signals[key]={state,detail}
  }
  const observed=(key:string,yes:boolean,detail:string)=>{
    mark(key,yes?'verified':'missing',detail)
  }
  try{
    let specialist='',level:'A'|'B'|'C'|'D'|null=null
    let steps:string[]=[],pending:string[]=[],teams=false
    if(game.sport==='football'&&game.league==='nfl'){
      specialist='NFL: QB, 44 titulares, OL/pass rush, lesiones y clima'
      const d=await investigateNfl(game.date,game.eventId,fetcher,now,env,quotes)
      if(!identities(d.event.home.name,d.event.away.name,game.home,game.away)
        ||!closeTime(d.event.scheduledAt,game.kickoff))
        throw Error('NFL: identidad u horario del evento no coinciden')
      level=d.coverage.level
      teams=d.teams.home.roster.length>0&&d.teams.away.roster.length>0
      steps=['Rosters NFL '+d.coverage.verifiedPlayers+' jugadores',
        'Resultados recientes '+d.coverage.formGames+' observaciones',
        'Titulares confirmados '+(d.coverage.confirmedOffense+d.coverage.confirmedDefense)+'/44',
        'Enfrentamientos individuales '+d.matchups.length]
      pending=d.missingEvidence
      observed('fixture',closeTime(d.event.scheduledAt,game.kickoff),
        'ESPN NFL: identificación y horario cotejados')
      observed('form',d.teams.home.recent.length>=3&&d.teams.away.recent.length>=3,
        'Últimos partidos comprobados por ambos rivales')
      observed('rosters',teams,'Rosters y roles observados para ambos equipos')
      const qb=(['home','away'] as const).every(side=>
        d.teams[side].roster.some(p=>p.role==='quarterback'&&p.confirmedOffense))
      mark('qb',qb?'verified':
        (['home','away'] as const).every(side=>d.teams[side].roster.some(p=>p.role==='quarterback'))
          ?'partial':'missing',
        'QB en roster no implica titular confirmado para hoy')
      mark('matchups',d.matchups.length?'partial':'missing',
        d.matchups.length+' enfrentamientos de candidatos; disponibilidad actual por confirmar')
      mark('weather',d.weather?.timestamp?'partial':'missing',
        'Datos meteorológicos disponibles; horario y estadio requieren cotejo')
      mark('market',d.markets.length?'partial':'missing',
        d.markets.length+' líneas; falta validar reglas exactas de la casa')
    }else if(game.sport==='basketball'&&(game.league==='nba'||game.league==='wnba')){
      specialist='NBA/WNBA: jugadores, quintetos, eficiencia y bajas'
      const d=await researchBasketballCase(game.league,game.date,game.eventId,
        fetcher,now,env,quotes)
      if(!identities(d.fixture.home.name,d.fixture.away.name,game.home,game.away)
        ||!closeTime(d.opportunity.scheduledAt,game.kickoff))
        throw Error('NBA/WNBA: identidad u horario del evento no coinciden')
      level=d.coverage.level
      teams=d.teams.home.roster.length>0&&d.teams.away.roster.length>0
      steps=['Jugadores en roster '+d.coverage.players,
        'Resultados recientes '+d.coverage.formGames,
        'Quintetos confirmados '+d.coverage.starters+'/10',
        'Eficiencia/pace verificados '+String(d.coverage.advancedMetrics)]
      pending=d.missingEvidence
      observed('fixture',closeTime(d.opportunity.scheduledAt,game.kickoff),
        'ESPN baloncesto: identidad y hora del evento')
      observed('form',d.teams.home.lastGames.length>=5&&d.teams.away.lastGames.length>=5,
        d.teams.home.name+': '+d.teams.home.wins+'V/'+d.teams.home.losses+
        'D en '+d.teams.home.lastGames.length+'; '+d.teams.away.name+': '+
        d.teams.away.wins+'V/'+d.teams.away.losses+'D en '+
        d.teams.away.lastGames.length)
      observed('rosters',teams,'Rosters ESPN: local '+
        d.teams.home.roster.length+' atletas; visitante '+
        d.teams.away.roster.length+' atletas')
      observed('starters',d.teams.home.quintetConfirmed&&d.teams.away.quintetConfirmed,
        'Dos quintetos titulares comprobados; roster no es titularidad')
      const metric=(side:'home'|'away')=>d.teams[side].teamStats
        .filter(x=>/pace|possessions|offensive.*rating|offrtg|defensive.*rating|defrtg/iu.test(x.name))
        .slice(0,3).map(x=>x.name+': '+x.value).join(', ')
      observed('efficiency',d.coverage.advancedMetrics,
        'Local '+(metric('home')||'sin cifras')+
        '; visitante '+(metric('away')||'sin cifras'))
      observed('schedule',d.context.restHours.home!==null&&d.context.restHours.away!==null,
        'Descanso local '+(d.context.restHours.home?.toFixed(1)??'?')+
        ' h; visitante '+(d.context.restHours.away?.toFixed(1)??'?')+' h')
      mark('market',d.markets.length?'partial':'missing',
        d.markets.length+' opciones consultadas, sujetas a fecha y liquidación')
    }else if(game.sport==='soccer'){
      specialist='Fútbol: once, xG, forma local/visita, lesiones y empate'
      const d=await investigateSoccer(game.date,game.league,game.eventId,
        fetcher,now,env,quotes)
      if(!identities(d.fixture.home.name,d.fixture.away.name,game.home,game.away)
        ||!closeTime(d.opportunity.scheduledAt,game.kickoff))
        throw Error('Fútbol: identidad u horario del evento no coinciden')
      level=d.coverage.level
      teams=d.teams.home.roster.length>0&&d.teams.away.roster.length>0
      steps=['Jugadores disponibles '+d.coverage.players,
        'Resultados recientes '+d.coverage.recentGames,
        'Onces verificados '+String(d.coverage.lineups),
        'Enfrentamientos individuales '+d.duels.length]
      pending=d.missingEvidence
      observed('fixture',closeTime(d.opportunity.scheduledAt,game.kickoff),
        'ESPN fútbol: local, visita y horario cotejados')
      observed('form',d.teams.home.recent.length>=5&&d.teams.away.recent.length>=5,
        'Forma y local/visita de ambos rivales')
      observed('rosters',teams,'Rosters específicos de los clubes')
      observed('lineups',d.lineupConfirmed.home&&d.lineupConfirmed.away,
        'Dos onces confirmados, no solo plantillas')
      const hasXg=d.teamStatistics.some(f=>/xg|expected goals/iu.test(f.label))
      mark('xg',hasXg?'partial':'missing',
        'Debe confirmarse xG y xGA para ambos clubes, no una única cifra')
      mark('injuries',d.injuries.length?'partial':'missing',
        'Bajas observadas; sin reporte completo de ambos clubes no se certifica disponibilidad')
      mark('draw',d.markets.some(m=>m.market==='1x2')?'partial':'missing',
        'Riesgo de empate y reglas reglamentarias de 90 minutos por validar')
      mark('market',d.markets.length?'partial':'missing',
        'Mercados observados; falta comprobar período, casa y fecha')
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
      observed('fixture',closeTime(match.date,game.kickoff),
        'NHL Web API: equipos y hora cotejados')
      observed('form',(d.form.home?.games??0)>=5&&(d.form.away?.games??0)>=5,
        'Resultados NHL y descanso de ambos clubes')
      observed('rosters',teams,'Jugadores NHL por club')
      mark('goalies',d.goalieCandidates.home.length&&d.goalieCandidates.away.length?
        'partial':'missing','Porteros candidatos: ninguno confirmado como titular')
      mark('xg','missing','xG 5v5/GSAx sin fuente verificable en este expediente')
      mark('special','missing','Unidades PP/PK y enfrentamientos sin métricas verificadas')
      mark('market',d.markets.length?'partial':'missing',
        'Precios observados; reglas de OT y shootout pendientes')
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
      observed('fixture',closeTime(match.date,game.kickoff),
        'MLB Stats API: equipos y horario cotejados')
      observed('form',(d.teamForm.home?.games??0)>=5&&(d.teamForm.away?.games??0)>=5,
        'Forma observada MLB para los dos equipos')
      observed('rosters',teams,'Rosters activos y perfiles')
      mark('starters',d.starters.home&&d.starters.away?'partial':'missing',
        'Abridores probables observados, no alineación definitiva de ambos')
      const freshBullpen=(['home','away'] as const).every(side=>
        d.bullpen[side].some(p=>p.reliefUsage72h.length>0))
      mark('bullpen',freshBullpen?'verified':d.bullpen.home.length&&d.bullpen.away.length?
        'partial':'missing','Bullpen y utilización de las últimas 72 horas')
      mark('matchups',d.matchups.some(m=>m.bvp!==null)?'partial':'missing',
        'Cruces bateador-pitcher observados; tamaños muestrales por cotejar')
      mark('weather',d.weather?'partial':'missing',
        'Viento, temperatura y estado del techo sujetos a horario de juego')
      mark('injuries',d.lineupStatus.home==='confirmed'&&d.lineupStatus.away==='confirmed'?
        'partial':'missing','Alineaciones y estado de lesionados por comprobar')
      mark('market',d.odds.length?'partial':'missing',
        'Líneas cotejadas; condiciones del mercado por confirmar')
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
      observed('fixture',closeTime(match.start,game.kickoff),
        'ESPN tenis: encuentro, ID y hora cotejados')
      observed('form',d.players.every(p=>p.lastMatches.length>=5),
        'Cinco partidos recientes por cada tenista')
      observed('players',teams&&d.coverage.rankCount===2,
        'Perfiles y rankings individuales')
      observed('surface',d.coverage.surfaceObserved,
        'Superficie específica declarada para el evento')
      observed('serve',d.coverage.advancedStatsPlayers===2,
        'Estadísticas de servicio y devolución de ambos tenistas')
      mark('fatigue',d.players.some(p=>p.lastMatches.length>0)?'partial':'missing',
        'Últimos partidos observados, pero fatiga y desplazamientos no verificados')
      mark('market',d.markets.length?'partial':'missing',
        'Mercado de tenis; formato, tie-breaks y condiciones por confirmar')
    }else return errorResult(game,'Sin especialista integrado para esta liga; no promover a ticket final')
    if(['nfl','nba','wnba','nhl','mlb'].includes(game.league)){
      // Read the public ESPN injury feed after the discipline-specific dossier;
      // fallback failures never erase evidence already collected.
      const injury=await fetchEspnInjuryBackup(game,fetcher,now)
      injuryAudit=injury
      if(injury.status==='verified'||injury.status==='partial'){
        // A feed can identify reported injuries, but never guarantees a final
        // inactive list, starting lineup or availability at tipoff/kickoff.
        mark('injuries',injury.status==='verified'&&injury.home.matched&&
          injury.away.matched?'verified':'partial',
          'ESPN reporte bilateral '+injury.status+
          ' · '+(injury.feedUpdatedAt??'sin hora')+
          ' · local '+injury.home.injuries.length+' y visitante '+
          injury.away.injuries.length+' registros; sin confirmar quinteto final')
        steps.push('ESPN lesiones '+injury.status+': local '+
          injury.home.injuries.length+' · visitante '+injury.away.injuries.length+
          ' · fuente '+injury.source)
        for(const item of [...injury.home.injuries,...injury.away.injuries].slice(0,12))
          steps.push('ESPN baja · '+item.team+' · '+item.athlete+
            ' · '+item.status+' · '+(item.reportedAt??'sin fecha'))
      }else pending.push('ESPN lesiones '+injury.status+': '+injury.source)
      pending.push(...injury.notes.slice(0,4))
    }
    const sourceChecks=await sourceTask
    const mismatches=sourceChecks.filter(s=>s.status==='conflict')
    if(mismatches.length)
      pending.push('Revisar localía en fuente secundaria: '+
        mismatches.map(x=>x.provider).join(', '))
    const checklist=auditSportChecklist(game.sport,signals,now)
    if(checklist.criticalPending.length)
      pending.push('Pasos obligatorios sin cerrar ('+
        checklist.criticalPending.length+'): '+
        checklist.criticalPending.slice(0,3).join('; '))
    return{...base,specialist,...classifySpecialistCoverage(level,teams,steps,pending),
      sourceChecks,checklist,...(injuryAudit?{injuryAudit}:{}),
      checkedAt:new Date(now).toISOString()}
  }catch(error){
    return errorResult(game,(error instanceof Error?error.message:String(error)))
  }
}

/** Bound the expensive dossier calls and maintain exact event order. */
export async function investigateTicketSpecialists(
  games:readonly SpecialistFixture[],fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,
  quotes:MarketOutcome[]=[],deadlineMs=20_000,
):Promise<SpecialistGate[]>{
  if(!Number.isInteger(deadlineMs)||deadlineMs<10||deadlineMs>90_000)
    throw Error('Presupuesto por expediente fuera de rango')
  const inspect=async(game:SpecialistFixture):Promise<SpecialistGate>=>{
    const controller=new AbortController()
    let timer:ReturnType<typeof setTimeout>|undefined
    // Preserve the provider's own timeout AND the ticket-wide leg budget.
    const guardedFetch:typeof fetch=(input,init)=>{
      const signal=init?.signal?AbortSignal.any([init.signal,controller.signal]):controller.signal
      return fetcher(input,{...init,signal})
    }
    try{
      return await Promise.race([
        investigateTicketSpecialist(game,guardedFetch,now,env,quotes),
        new Promise<SpecialistGate>(resolve=>{
          timer=setTimeout(()=>{
            controller.abort()
            resolve(errorResult(game,'Límite de investigación ('+deadlineMs+
              ' ms) alcanzado. Expediente condicional; comprobar la fuente antes de apostar.'))
          },deadlineMs)
        }),
      ])
    }finally{if(timer!==undefined)clearTimeout(timer)}
  }
  const audited:SpecialistGate[]=[]
  for(let offset=0;offset<games.length;offset+=4){
    const batch=await Promise.all(games.slice(offset,offset+4).map(inspect))
    audited.push(...batch)
  }
  return audited
}
