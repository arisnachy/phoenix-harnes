/** Mandatory, sport-specific pregame dossier audit before any automated ticket is quoted.
 * A successful fetch is not proof of a starting lineup, calibrated edge, or permission
 * to describe a leg as approved. Absent/partial specialist research fails closed.
 */
import type {MarketOutcome} from './sports.ts'
import {crosscheckFreeFixture,type BackupFinding} from './free-sports-source-audit.ts'
import {auditSportChecklist,type SportChecklist,type StepObservation} from './daily-specialist-checklist.ts'
import {fetchEspnInjuryBackup,type InjuryBackup} from './espn-injury-backup.ts'
import {inspectKeylessInjurySources,type FreeInjurySource} from './free-injury-web.ts'
import {investigateNfl} from './nfl-evidence-research.ts'
import {researchBasketballCase} from './basketball-evidence-dossier.ts'
import {auditBasketballGranularEvidence} from './basketball-granular-evidence.ts'
import {nflDeepSignals,nhlDeepSignals,mlbDeepSignals,
  soccerDeepSignals,tennisDeepSignals} from './sports-granular-bridge.ts'
import {investigateSoccer} from './soccer-worldwide-dossier.ts'
import {assessSoccerDrawRisk,type SoccerDrawAudit} from './soccer-draw-risk.ts'
import {probeNhlOfficialStarters,type NhlStarterProbe} from './nhl-official-starters.ts'
import {probeNhlPregameScratches,type NhlScratchProbe} from './nhl-pregame-scratches.ts'
import {nhlSlate,investigateNhl,type NhlOfficialShots} from './nhl-evidence-research.ts'
import {nhlGoalieEvidence,type NhlGoalieForm} from './nhl-goalie-evidence.ts'
import type {NhlSkaterImpact} from './nhl-skater-impact.ts'
import {sameEspnTeam} from './sports-exact-espn-winner.ts'
import {discoverMlbDay,researchMlbCase,type MlbMatchup} from './mlb-evidence-research.ts'
import {tennisSlate,investigateTennis,type TennisTour} from './tennis-evidence-research.ts'

export type ComparativeTeam={name:string;recentResults:string[];
  teamStats:Array<{name:string;value:string}>;
  players:Array<{name:string;role:string;dataStatus:string;
    starterConfirmed:boolean;stats:Array<{name:string;value:string}>;
    recent:Array<{name:string;value:string}>;
    splits:Array<{name:string;value:string}>}>}
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
  /** NBA unavailable reports reconciled by exact athlete ID to both current rosters. */
  rosterMatchedInjuries?:{home:Array<{athlete:string;status:string;reportedAt:string|null}>;
    away:Array<{athlete:string;status:string;reportedAt:string|null}>}
  /** Rest measured from the researched NBA/WNBA fixture; not an inferred B2B. */
  restHours?:{home:number|null;away:number|null}
  /** Actual bilateral roster/player statistics for Kira to read, never a score. */
  teamComparison?:{home:ComparativeTeam;away:ComparativeTeam}
  /** Published/indexed headlines; none is verification of the article body. */
  newsFindings?:Array<{title:string;publisher:string;publishedAt:string|null;
    status:'reported-headline'|'indexed-headline-only'}>
  /** Opponent-specific evidence: potential positional duels are NOT historical matchups. */
  playerMatchups?:Array<{athlete:string;opponent:string;detail:string;
    status:'observed'|'candidate';source:string}>
  /** Independent empirical draw-risk assessment, not proof of 1X2 odds. */
  soccerDrawAudit?:SoccerDrawAudit
  /** Official NHL gamecenter starter flags, never inferred from roster. */
  nhlStarterAudit?:NhlStarterProbe
  /** NHL right-rail observations; never a certified final lineup. */
  nhlScratchAudit?:NhlScratchProbe
  /** Actual appearances / weighted save fraction, not a starter prediction. */
  nhlGoalieFormAudit?:{home:NhlGoalieForm[];away:NhlGoalieForm[]}
  nhlTeamShotsAudit?:NhlOfficialShots
  nhlSkaterImpactAudit?:{home:NhlSkaterImpact[];away:NhlSkaterImpact[]}
  /** No-key official-report link and cautious secondary injury observations. */
  freeInjuryChecks?:FreeInjurySource[]
  /** Actual source URLs and their results; a 200 without data is not verified. */
  endpointAudit?:Array<{url:string;status:'verified'|'empty'|'error';
    checkedAt:string;detail:string}>
  playerHistoryAudit?:{provider:string;rosterPlayers:number;inspectedPlayers:number;
    gameLogsFound:number;homeAwaySplitsFound:number;note:string}
}
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const identities=(a:string,b:string,home:string,away:string)=>
  norm(a)===norm(home)&&norm(b)===norm(away)
const closeTime=(a:string,b:string)=>
  Number.isFinite(Date.parse(a))&&Number.isFinite(Date.parse(b))&&
  Math.abs(Date.parse(a)-Date.parse(b))<=90*60_000

/** Publish actual historical MLB batter-versus-pitcher results separately from possible duels. */
export function visibleMlbBvpDuels(duels:readonly MlbMatchup[],
  homeBatterIds:ReadonlySet<number>,awayBatterIds:ReadonlySet<number>)
  :NonNullable<SpecialistGate['playerMatchups']>{
  const evidence=(ids:ReadonlySet<number>)=>{
    const candidates=duels.filter(d=>ids.has(d.batterId))
    const observed=candidates.filter(d=>Number(d.bvp?.atBats??0)>0).slice(0,5)
    const proposed=candidates.filter(d=>d.pitcherRole==='probable-starter'&&
      !(Number(d.bvp?.atBats??0)>0)).slice(0,2)
    return [...observed,...proposed].map(d=>{
      const historical=Number(d.bvp?.atBats??0)>0
      return{athlete:d.batter,opponent:d.pitcher,
        detail:historical?
          d.observations.filter(x=>x.startsWith('BvP registrado:')).join(' · '):
          'Cruce posible con abridor probable, sin turnos BvP comprobados',
        status:historical?'observed' as const:'candidate' as const,
        source:historical?'MLB Stats API · turnos históricos por ID':
          'MLB Stats API · roster y abridor probable, no enfrentamiento probado',
      }
    })
  }
  return [...evidence(homeBatterIds),...evidence(awayBatterIds)]
}

/** The official NHL game ID must identify exactly one matching fixture. */
export function resolveNhlTicketMatch<T extends {
  id:string;date:string;home:{name:string};away:{name:string}
}>(slate:readonly T[],target:Pick<SpecialistFixture,'home'|'away'|'kickoff'>):T|null{
  // Official NHL score feeds may expose unambiguous nicknames only (e.g.
  // "Kraken" vs ESPN "Seattle Kraken"). Use the existing exact NHL franchise
  // alias table; still require BOTH teams and a matching kickoff, exactly once.
  const matches=slate.filter(x=>
    sameEspnTeam(x.home.name,target.home,'icehockey_nhl')&&
    sameEspnTeam(x.away.name,target.away,'icehockey_nhl')&&
    closeTime(x.date,target.kickoff))
  return matches.length===1?matches[0]!:null
}

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
  // Independent no-key pages run concurrently with the specialist; they do
  // not replace ESPN IDs or convert a listing into an official inactive list.
  const freeInjuryTask=eligible?
    inspectKeylessInjurySources(game,fetcher,now).catch(()=>[] as FreeInjurySource[]):
    Promise.resolve([] as FreeInjurySource[])
  // This used to start only AFTER the expensive NBA/NHL dossier, adding up
  // to an additional HTTP deadline to every selected leg. Acquire in parallel.
  const injuryTask=['nfl','nba','wnba','nhl','mlb'].includes(game.league)?
    fetchEspnInjuryBackup(game,fetcher,now).catch(()=>null):
    Promise.resolve(null)
  // The first specialist pass receives no selected bookmaker quotes.
  // A provisional market count never proves event/side/period/price. The
  // post-quote pass in evidence-priced-ticket credits 'market' only after
  // matching a real quote to the ESPN fixture and selected outcome.
  const signals:Record<string,StepObservation>={}
  let injuryAudit:InjuryBackup|undefined
  let rosterMatchedInjuries:SpecialistGate['rosterMatchedInjuries']
  let restHours:SpecialistGate['restHours']
  let teamComparison:SpecialistGate['teamComparison']
  let newsFindings:SpecialistGate['newsFindings']
  let playerMatchups:SpecialistGate['playerMatchups']
  let soccerDrawAudit:SoccerDrawAudit|undefined
  let nhlStarterAudit:NhlStarterProbe|undefined
  let nhlScratchAudit:NhlScratchProbe|undefined
  let nhlGoalieFormAudit:SpecialistGate['nhlGoalieFormAudit']
  let nhlTeamShotsAudit:NhlOfficialShots|undefined
  let nhlSkaterImpactAudit:SpecialistGate['nhlSkaterImpactAudit']
  const mark=(key:string,state:StepObservation['state'],detail:string)=>{
    signals[key]={state,detail}
  }
  const observed=(key:string,yes:boolean,detail:string)=>{
    mark(key,yes?'verified':'missing',detail)
  }
  try{
    let specialist='',level:'A'|'B'|'C'|'D'|null=null
    let steps:string[]=[],pending:string[]=[],teams=false
    let endpointAudit:SpecialistGate['endpointAudit']
    let playerHistoryAudit:SpecialistGate['playerHistoryAudit']
    let rosterIds:Record<'home'|'away',Set<string>>|undefined
    if(game.sport==='football'&&game.league==='nfl'){
      specialist='NFL: QB, 44 titulares, OL/pass rush, lesiones y clima'
      const d=await investigateNfl(game.date,game.eventId,fetcher,now,env,quotes)
      if(!identities(d.event.home.name,d.event.away.name,game.home,game.away)
        ||!closeTime(d.event.scheduledAt,game.kickoff))
        throw Error('NFL: identidad u horario del evento no coinciden')
      level=d.coverage.level
      const comparative=(side:'home'|'away'):ComparativeTeam=>({
        name:d.teams[side].name,
        recentResults:d.teams[side].recent.map(x=>x.date+' '+x.opponent+
          ' '+x.pts+'-'+x.allowed+' '+x.homeAway),
        teamStats:d.teams[side].teamStats,
        players:d.teams[side].roster.map(p=>({name:p.name,role:p.role,
          dataStatus:p.status,starterConfirmed:p.confirmedOffense||p.confirmedDefense,
          stats:p.statistics,recent:p.lastGames,splits:[]})),
      })
      teamComparison={home:comparative('home'),away:comparative('away')}
      playerMatchups=d.matchups.slice(0,16).map(x=>({athlete:x.attacker,
        opponent:x.against,detail:'Duelo posicional posible: '+
          x.candidates.slice(0,3).map(p=>p.name+' ('+p.role+')').join(', '),
        status:'candidate' as const,source:'Roster NFL; sin jugadas directas confirmadas'}))
      newsFindings=[...d.news.map(x=>({title:x.title,publisher:x.source,
        publishedAt:x.published,status:'reported-headline' as const})),
        ...d.editorial.map(x=>({title:x.title,publisher:x.publisher,
          publishedAt:null,status:'indexed-headline-only' as const}))].slice(0,16)
      teams=d.teams.home.roster.length>0&&d.teams.away.roster.length>0
      steps=['Rosters NFL '+d.coverage.verifiedPlayers+' jugadores',
        'Resultados recientes '+d.coverage.formGames+' observaciones',
        'Titulares confirmados '+(d.coverage.confirmedOffense+d.coverage.confirmedDefense)+'/44',
        'Enfrentamientos individuales '+d.matchups.length]
      pending=d.missingEvidence
      Object.assign(signals,nflDeepSignals(d))
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
      restHours={home:d.context.restHours.home,away:d.context.restHours.away}
      const comparative=(side:'home'|'away'):ComparativeTeam=>({
        name:d.teams[side].name,
        recentResults:d.teams[side].lastGames.map(g=>g.date+' '+g.opponent+
          ' '+g.pts+'-'+g.allowed+' '+g.location),
        teamStats:d.teams[side].teamStats,
        players:d.teams[side].roster.map(p=>({name:p.name,role:p.position,
          dataStatus:p.status,starterConfirmed:p.confirmedStarter,
          stats:p.stats,recent:p.lastGames,splits:p.splits})),
      })
      teamComparison={home:comparative('home'),away:comparative('away')}
      playerMatchups=d.matchups.slice(0,16).map(x=>({athlete:x.attacker,
        opponent:x.opponents.slice(0,3).map(p=>p.name).join(', '),detail:x.note,
        status:'candidate' as const,
        source:'Duelo de roster NBA/WNBA, no histórico directo documentado'}))
      newsFindings=[...d.news.map(x=>({title:x.headline,publisher:x.source,
        publishedAt:x.published,status:'reported-headline' as const})),
        ...d.editorial.map(x=>({title:x.headline,publisher:x.publisher,
          publishedAt:x.date,status:'indexed-headline-only' as const}))].slice(0,16)
      endpointAudit=[
        ...d.sources.map(x=>({url:x.url,status:x.status,checkedAt:x.observedAt,
          detail:x.reason??'ESPN: respuesta y datos clasificados por la fuente'})),
        ...(['home','away'] as const).flatMap(side=>d.teams[side].sourceCoverage.map(x=>({
          url:x.endpoint,checkedAt:d.checkedAt,
          status:x.status==='available'?'verified' as const:
            x.status==='empty'?'empty' as const:'error' as const,
          detail:'ESPN estadísticas '+d.teams[side].name+' · '+x.status,
        }))),
      ]
      teams=d.teams.home.roster.length>0&&d.teams.away.roster.length>0
      const inspected=[...d.teams.home.roster,...d.teams.away.roster]
      const observedPlayers=[...d.teams.home.roster,...d.teams.away.roster]
        .filter(p=>p.lastGames.length>0||p.splits.length>0)
      playerHistoryAudit={
        provider:'ESPN Common v3',rosterPlayers:inspected.length,
        inspectedPlayers:inspected.length,
        gameLogsFound:observedPlayers.filter(p=>p.lastGames.length>0).length,
        homeAwaySplitsFound:observedPlayers.filter(p=>
          p.splits.some(x=>/home|local/iu.test(x.name))&&
          p.splits.some(x=>/away|road|visit/iu.test(x.name))).length,
        note:'Cada jugador contiene hasta 20 partidos y sus splits por sede; '+ 
          'una respuesta vacía no se declara verificada.',
      }
      rosterIds={home:new Set(d.teams.home.roster.map(p=>p.id)),
        away:new Set(d.teams.away.roster.map(p=>p.id))}
      steps=['Jugadores en roster '+d.coverage.players,
        'Resultados recientes '+d.coverage.formGames,
        'Quintetos confirmados '+d.coverage.starters+'/10',
        'Eficiencia/pace verificados '+String(d.coverage.advancedMetrics)]
      pending=d.missingEvidence
      Object.assign(signals,auditBasketballGranularEvidence(d))
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
      const comparativeSoccer=(side:'home'|'away'):ComparativeTeam=>({
        name:d.teams[side].name,
        recentResults:d.teams[side].recent.map(g=>g.date+' '+g.opponent+
          ' '+g.scored+'-'+g.allowed+' '+g.homeAway),
        teamStats:[{name:'récord publicado',value:d.teams[side].record.join('; ')}],
        players:d.teams[side].roster.map(p=>({name:p.name,role:p.position,
          dataStatus:'plantilla publicada; lesiones en informe aparte',
          starterConfirmed:p.confirmedStarter,
          stats:p.facts.map(f=>({name:f.label,value:f.value})),recent:[],splits:[]})),
      })
      teamComparison={home:comparativeSoccer('home'),away:comparativeSoccer('away')}
      playerMatchups=d.duels.slice(0,16).map(x=>({athlete:x.attacker,
        opponent:x.opponents.slice(0,3).map(p=>p.name).join(', '),
        detail:x.limitations.slice(0,2).join('; '),status:'candidate' as const,
        source:'Fútbol: formación de roster, sin enfrentamiento directo comprobado'}))
      newsFindings=[...d.headlines.map(x=>({title:x.title,publisher:x.source,
        publishedAt:x.published,status:'reported-headline' as const})),
        ...d.editorial.map(x=>({title:x.title,publisher:x.publisher,
          publishedAt:x.published,status:'indexed-headline-only' as const}))].slice(0,16)
      teams=d.teams.home.roster.length>0&&d.teams.away.roster.length>0
      steps=['Jugadores disponibles '+d.coverage.players,
        'Resultados recientes '+d.coverage.recentGames,
        'Onces verificados '+String(d.coverage.lineups),
        'Enfrentamientos individuales '+d.duels.length]
      pending=d.missingEvidence
      // Both teams' past scoreboards already came from ESPN. Use their
      // chronological, venue-aware results instead of adding unsupported
      // calls to an xG vendor for leagues it does not cover.
      soccerDrawAudit=assessSoccerDrawRisk({
        home:{name:d.teams.home.name,recent:d.teams.home.recent},
        away:{name:d.teams.away.name,recent:d.teams.away.recent},
        kickoff:d.fixture.scheduledAt,statistics:d.teamStatistics,
      })
      steps.push(...soccerDrawAudit.indicators)
      if(soccerDrawAudit.requiresAlternativeReview)
        pending.push('Empate: indicadores elevados; buscar doble oportunidad o reemplazar ganador 1X2')
      pending.push(...soccerDrawAudit.unverified)
      Object.assign(signals,soccerDeepSignals(d))
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
      mark('draw',soccerDrawAudit.status==='assessed'?'verified':
        soccerDrawAudit.status==='partial'?'partial':'missing',
        'Análisis independiente de empate: '+soccerDrawAudit.status+
        ' · '+soccerDrawAudit.tier+' · promedio histórico '+
        (soccerDrawAudit.averageHistoricalDrawPct??'?')+
        '%. No es una probabilidad calibrada ni acredita cuotas 1X2')
      mark('market',d.markets.length?'partial':'missing',
        'Mercados observados; falta comprobar período, casa y fecha')
    }else if(game.sport==='hockey'&&game.league==='nhl'){
      specialist='NHL: porteros, forma, tiros y unidades especiales'
      const slate=await nhlSlate(game.date,fetcher,now)
      const match=resolveNhlTicketMatch(slate.games,game)
      if(!match)throw Error('NHL: sin correspondencia oficial de ambos equipos y fecha')
      // Goalie starter flags and the full player-history dossier are independent
      // official reads. Parallel acquisition saves the sequential goalie wait.
      const [d,starterReport,scratchReport]=await Promise.all([
        investigateNhl(game.date,match.id,fetcher,now,quotes),
        probeNhlOfficialStarters({
          gameId:match.id,homeAbbrev:match.home.abbrev,awayAbbrev:match.away.abbrev,
          kickoff:match.date,
        },fetcher,now),
        probeNhlPregameScratches({
          gameId:match.id,homeAbbrev:match.home.abbrev,awayAbbrev:match.away.abbrev,
          kickoff:match.date,
        },fetcher,now),
      ])
      // NHL IDs are not ESPN IDs. Validate again after fetching the official
      // dossier to prevent a goalie report from a different game entering it.
      if(d.fixture.id!==match.id||
        !(sameEspnTeam(d.fixture.home.name,game.home,'icehockey_nhl')&&
          sameEspnTeam(d.fixture.away.name,game.away,'icehockey_nhl'))||
        !closeTime(d.fixture.date,game.kickoff))
        throw Error('NHL: informe de porteros pertenece a otro partido; datos descartados')
      level=d.opportunity.decision==='investigate'?'B':'C'
      teams=d.players.home.length>0&&d.players.away.length>0
      const comparative=(side:'home'|'away'):ComparativeTeam=>({
        name:side==='home'?game.home:game.away,
        recentResults:(d.form[side]?.last10??[]).map(g=>g.date+' '+g.opponent+
          ' '+g.goalsFor+'-'+g.goalsAgainst+' '+g.location+' '+g.outcome),
        teamStats:Object.entries(d.officialShots[side]).map(([name,value])=>({
          name,value:value===null?'no disponible':String(value)})),
        players:d.players[side].map(p=>({name:p.name,role:p.role,
          dataStatus:'estadísticas de roster; disponibilidad física no inferida',
          starterConfirmed:p.starterConfirmed,
          stats:Object.entries(p.stats).map(([name,value])=>({name,value})),
          recent:p.last5.map(g=>({name:g.date,value:g.summary})),splits:[]})),
      })
      teamComparison={home:comparative('home'),away:comparative('away')}
      playerMatchups=d.possibleMatchups.slice(0,14).map(x=>({
        athlete:x.attacker,opponent:x.againstGoalies.join(', '),
        detail:'Candidatos según roster; sin enfrentamiento histórico publicado',
        status:'candidate' as const,source:'NHL roster · no implica portero titular',
      }))
      nhlGoalieFormAudit={
        home:nhlGoalieEvidence(d.goalieCandidates.home,d.fixture.date),
        away:nhlGoalieEvidence(d.goalieCandidates.away,d.fixture.date),
      }
      nhlTeamShotsAudit=d.officialShots
      nhlSkaterImpactAudit={
        home:d.skaterImpact.home.slice(0,10),away:d.skaterImpact.away.slice(0,10),
      }
      const playerSet=[...d.players.home,...d.players.away]
      playerHistoryAudit={
        provider:'NHL Web API (IDs oficiales NHL)',
        rosterPlayers:playerSet.length,
        inspectedPlayers:playerSet.filter(p=>p.last20!==undefined).length,
        gameLogsFound:playerSet.filter(p=>(p.last20?.length??0)>0).length,
        homeAwaySplitsFound:playerSet.filter(p=>p.homeRoadSplits?.home&&
          p.homeRoadSplits?.away).length,
        note:'Game-log de temporada por ID NHL, máximo 20 juegos por atleta. '+
          'Promedios local/visita calculados únicamente con sede informada.',
      }
      steps=['Rosters '+(d.players.home.length+d.players.away.length),
        'Porteros candidatos '+(d.goalieCandidates.home.length+d.goalieCandidates.away.length),
        'Forma local/visita '+(d.form.home?.games??0)+'/'+(d.form.away?.games??0)]
      nhlStarterAudit=starterReport
      nhlScratchAudit=scratchReport
      endpointAudit??=[]
      endpointAudit.push({url:nhlStarterAudit.url,
        status:nhlStarterAudit.state==='confirmed'?'verified':
          nhlStarterAudit.state==='unavailable'?'error':'empty',
        checkedAt:nhlStarterAudit.checkedAt,detail:nhlStarterAudit.note})
      endpointAudit.push({url:nhlScratchAudit.url,
        status:nhlScratchAudit.state==='observed'?'verified':
          nhlScratchAudit.state==='unavailable'?'error':'empty',
        checkedAt:nhlScratchAudit.checkedAt,
        detail:nhlScratchAudit.note+'; jamás confirma la planilla final'})
      pending=nhlStarterAudit.state==='confirmed'?
        d.missingEvidence.filter(x=>!/Ningún portero confirmado/iu.test(x)):
        d.missingEvidence
      Object.assign(signals,nhlDeepSignals(d))
      steps.push('NHL anotadores cotejados con roster oficial: '+
        d.skaterImpact.home.length+' local, '+d.skaterImpact.away.length+' visitante')
      steps.push('NHL tiros oficiales '+Number(d.officialShots.complete)+
        '/1 pareja de equipos · son shots, NO xG 5v5')
      steps.push('NHL porteros con datos de sus últimas 5 apariciones: '+
        [...nhlGoalieFormAudit.home,...nhlGoalieFormAudit.away].filter(g=>
          g.recentGames>0).length)
      steps.push('NHL jugadores con historial '+playerHistoryAudit.gameLogsFound+
        '/'+playerHistoryAudit.inspectedPlayers+
        ' · con splits local/visita '+playerHistoryAudit.homeAwaySplitsFound)
      observed('fixture',closeTime(match.date,game.kickoff),
        'NHL Web API: equipos y hora cotejados')
      observed('form',(d.form.home?.games??0)>=5&&(d.form.away?.games??0)>=5,
        'Resultados NHL y descanso de ambos clubes')
      observed('rosters',teams,'Jugadores NHL por club')
      mark('goalies',nhlStarterAudit.state==='confirmed'?'verified':
        d.goalieCandidates.home.length&&d.goalieCandidates.away.length?'partial':'missing',
        nhlStarterAudit.state==='confirmed'?
          'NHL oficial: local '+nhlStarterAudit.homeGoalie+
          ' · visitante '+nhlStarterAudit.awayGoalie+
          '; titulares explícitos antes del inicio, sujetos a cambio de última hora':
          'Porteros sin confirmación oficial: '+nhlStarterAudit.note)
      // Expected goals and GSAx are different from NHL shots and save percentage.
      // Keep the unobserved private metric missing; the compact research
      // checklist treats it as an advanced uncertainty, not a hard stop.
      const advancedOk=d.advanced?.status==='verified'&&
        d.advanced.teams.home!==null&&d.advanced.teams.away!==null
      mark('xg',advancedOk?'verified':'missing',advancedOk?
        'MoneyPuck 5v5 ambos clubes, xG/xGA verificados al corte '+
          d.advanced.updatedAt+'; GSAx por portero disponible por separado':
        '5v5 xG/xGA no verificados: '+(d.advanced?.reason??'fuente ausente'))
      mark('scratches',nhlScratchAudit.state==='observed'?'partial':'missing',
        nhlScratchAudit.state==='observed'?
          'NHL right-rail: '+nhlScratchAudit.home.length+' local / '+
          nhlScratchAudit.away.length+' visitante; no garantiza planilla final':
          'NHL scratches sin publicación pregame: '+nhlScratchAudit.note)
      if(nhlScratchAudit.state==='observed')
        steps.push('NHL scratches observados: local '+nhlScratchAudit.home.length+
          ', visitante '+nhlScratchAudit.away.length+
          '; estado lesión/suspensión por cotejar')
      else pending.push('Scratches NHL no verificados antes del inicio: '+
        nhlScratchAudit.note)
      const metrics=d.specialTeams
      const observedCount=[metrics.home.powerPlayPct,metrics.home.penaltyKillPct,
        metrics.away.powerPlayPct,metrics.away.penaltyKillPct]
        .filter(value=>value!==null).length
      mark('special',metrics.complete?'verified':observedCount?'partial':'missing',
        'NHL Stats REST: PP/PK oficiales '+observedCount+'/4 métricas de ambos clubes'+
        (metrics.complete?'; no equivale a xG ni confirma líneas':' · datos incompletos'))
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
      const comparativeMlb=(side:'home'|'away'):ComparativeTeam=>({
        name:match[side].name,
        recentResults:(d.teamForm[side]?.lastResults??[]).map(g=>g.date+' '+
          g.opponentId+' '+g.scored+'-'+g.allowed+' '+g.side),
        teamStats:d.seasonRecord[side]?[{name:'season wins',value:String(d.seasonRecord[side]!.wins)},
          {name:'season losses',value:String(d.seasonRecord[side]!.losses)}]:[],
        players:d.rosters[side].map(p=>({name:p.name,role:p.role+' '+p.position,
          dataStatus:p.evidence+'; lesiones y alineación por confirmar',
          starterConfirmed:p.lineupConfirmed,
          stats:Object.entries(p.season).map(([name,value])=>({name,value})),
          recent:[...Object.entries(p.lastFive).map(([name,value])=>({name,value})),
            ...p.recentStarts.slice(0,3).map(g=>({name:g.date+' start',
              value:g.innings+' IP; '+g.pitches+' pitches'})),
            ...p.reliefUsage72h.slice(0,3).map(g=>({name:g.date+' bullpen',
              value:g.innings+' IP; '+g.pitches+' pitches'}))],splits:[]})),
      })
      teamComparison={home:comparativeMlb('home'),away:comparativeMlb('away')}
      playerMatchups=d.matchups.slice(0,18).map(x=>({athlete:x.batter,
        opponent:x.pitcher,detail:x.bvp?Object.entries(x.bvp).map(([key,value])=>
          key+': '+value).join('; '):x.observations.slice(0,2).join('; '),
        status:x.bvp?'observed' as const:'candidate' as const,
        source:x.bvp?'MLB Stats API · enfrentamiento BvP observado':
          'Cruce de rol bateador-lanzador, historial BvP no disponible'}))
      playerMatchups=visibleMlbBvpDuels(d.matchups,
        new Set(d.rosters.home.filter(p=>p.role==='batter').map(p=>p.id)),
        new Set(d.rosters.away.filter(p=>p.role==='batter').map(p=>p.id)))
      newsFindings=[...d.news.map(x=>({title:x.headline,publisher:x.source,
        publishedAt:x.published,status:'reported-headline' as const})),
        ...d.externalHeadlines.map(x=>({title:x.headline,publisher:x.source,
          publishedAt:x.published,status:'indexed-headline-only' as const}))].slice(0,16)
      teams=d.rosters.home.length>0&&d.rosters.away.length>0
      steps=['Abridores '+Number(d.starters.home!==null&&d.starters.away!==null)+'/1 pareja',
        'Rosters '+(d.rosters.home.length+d.rosters.away.length),
        'Cruces bateador-lanzador '+d.matchups.length,
        'Escenarios por entradas '+d.scenarioAnalysis.length]
      pending=d.missingEvidence
      Object.assign(signals,mlbDeepSignals(d))
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
      const comparativeTennis=(index:0|1):ComparativeTeam=>{
        const player=d.players[index]
        return{name:player.player.name,
          recentResults:player.lastMatches.map(g=>g.date+' '+g.opponent+' '+g.result),
          teamStats:[{name:'ranking',value:String(player.player.ranking??'no verificado')},
            {name:'superficie',value:match.surface??'no verificada'}],
          players:[{name:player.player.name,role:'singles',
            dataStatus:player.profileAvailable?'perfil observado':'perfil incompleto',
            starterConfirmed:false,stats:player.statistics,recent:player.lastMatches.map(g=>({
              name:g.date,value:g.opponent+' '+g.result})),splits:[]}],
        }
      }
      teamComparison={home:comparativeTennis(0),away:comparativeTennis(1)}
      teams=d.players.every(x=>x.profileAvailable)
      steps=['Superficie verificada '+String(d.coverage.surfaceObserved),
        'Rankings verificados '+d.coverage.rankCount+'/2',
        'Servicio/devolución '+d.coverage.advancedStatsPlayers+'/2 jugadores']
      pending=d.missingEvidence
      Object.assign(signals,tennisDeepSignals(d))
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
      const injury=await injuryTask
      if(!injury){
        pending.push('ESPN lesiones: lectura fallida; conservar expediente deportivo')
      }else{
      injuryAudit=injury
      if(injury.status==='verified'||injury.status==='partial'){
        // A feed can identify reported injuries, but never guarantees a final
        // inactive list, starting lineup or availability at tipoff/kickoff.
        mark('injuries','partial',
          'ESPN reporte bilateral '+injury.status+
          ' · '+(injury.feedUpdatedAt??'sin hora')+
          ' · local '+injury.home.injuries.length+' y visitante '+
          injury.away.injuries.length+' registros; sin confirmar quinteto final')
        // ESPN day-to-day/questionable is an uncertain availability report,
        // never a confirmed absence or a definitive NBA/NFL inactive list.
        const injured=[...injury.home.injuries,...injury.away.injuries]
        // ESPN's league feed can include a past transaction, a player outside
        // today's active roster or ambiguous team affiliation. Preserve every
        // original record in injuryAudit but do not promote it to a confirmed
        // absence for the selected team's current roster.
        const unmatched=rosterIds?(['home','away'] as const).flatMap(side=>
          injury[side].injuries.filter(x=>!x.athleteId||
            !rosterIds![side].has(x.athleteId))):[]
        if(unmatched.length){
          injury.notes.push('ESPN lesiones: '+unmatched.length+
            ' registros NO conciliados con roster de ambos clubes; '+
            'conservar como referencia, NO usarlos como bajas confirmadas')
          pending.push('Conciliación de lesiones pendiente: '+unmatched.length+
            ' atletas fuera del roster vigente o sin ID verificado')
        }
        const verifiedRosterInjuries=rosterIds?injured.filter(x=>
          (injury.home.injuries.includes(x)&&x.athleteId&&rosterIds!.home.has(x.athleteId))||
          (injury.away.injuries.includes(x)&&x.athleteId&&rosterIds!.away.has(x.athleteId))):injured
        // Injury feeds often omit a healthy/opponent team entirely. Preserve
        // independently matched rows for either side; a missing team group is
        // NOT proof that the opponent has zero injuries.
        if(rosterIds&&(injury.home.matched||injury.away.matched)){
          const lean=(rows:typeof verifiedRosterInjuries)=>rows.map(x=>({
            athlete:x.athlete,status:x.status,reportedAt:x.reportedAt,
          }))
          rosterMatchedInjuries={
            home:lean(verifiedRosterInjuries.filter(x=>injury.home.injuries.includes(x))),
            away:lean(verifiedRosterInjuries.filter(x=>injury.away.injuries.includes(x))),
          }
        }
        const note=verifiedRosterInjuries.slice(0,8).map(x=>x.athlete+' ('+x.status+
          ', '+(x.reportedAt??'sin fecha')+')').join('; ')
        const detail='ESPN '+injury.source+'; local '+
          injury.home.injuries.length+', visitante '+
          injury.away.injuries.length+'; '+note
        if(game.sport==='basketball'){
          mark('B08','partial',detail+
            '; pendiente parte oficial NBA/WNBA y efecto en rotación')
          mark('U05','partial',detail+
            '; pendiente confirmación de quinteto y minutos')
        }
        steps.push('ESPN lesiones '+injury.status+': local '+
          injury.home.injuries.length+' · visitante '+injury.away.injuries.length+
          ' · fuente '+injury.source)
        for(const item of verifiedRosterInjuries.slice(0,12))
          steps.push('ESPN baja · '+item.team+' · '+item.athlete+
            ' · '+item.status+' · '+(item.reportedAt??'sin fecha'))
      }else pending.push('ESPN lesiones '+injury.status+': '+injury.source)
      pending.push(...injury.notes.slice(0,4))
      }
    }
    const freeInjuryChecks=await freeInjuryTask
    if(freeInjuryChecks.length){
      endpointAudit??=[]
      for(const check of freeInjuryChecks){
        const counted=check.players.length
        endpointAudit.push({url:check.reportUrl??check.url,checkedAt:new Date(now).toISOString(),
          status:check.state==='matched'||check.state==='linked'?'verified':
            check.state==='unavailable'?'error':'empty',
          detail:check.provider+': '+check.note+'; jugadores '+counted+
            '. Esta lectura NO confirma el quinteto titular ni el estado final.'})
        if(check.state==='linked'){
          steps.push('NBA parte oficial fechado identificado: '+check.reportUrl)
          pending.push('Leer y conciliar PDF NBA oficial antes del inicio: '+check.reportUrl)
        }
        if(check.state==='matched'){
          steps.push(check.provider+': '+counted+' observaciones de lesiones secundarias')
          const relevant=check.players.filter(p=>
            /^(?:Out|Doubtful|Questionable|Day-to-Day)$/u.test(p.status))
          if(relevant.length)pending.push(check.provider+
            ': comprobar contra parte oficial / roster: '+
            relevant.slice(0,4).map(p=>p.team+' / '+p.athlete+
              ' ('+p.status+')').join('; '))
        }
      }
      if(injuryAudit)injuryAudit.notes.push('Fuentes gratuitas independientes: '+
        freeInjuryChecks.map(c=>c.provider+' '+c.state).join(' · '))
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
      ...(rosterMatchedInjuries?{rosterMatchedInjuries}:{}),
      ...(restHours?{restHours}:{}),
      ...(teamComparison?{teamComparison}:{}),
      ...(newsFindings?{newsFindings}:{}),
      ...(playerMatchups?{playerMatchups}:{}),
      ...(soccerDrawAudit?{soccerDrawAudit}:{}),
      ...(nhlStarterAudit?{nhlStarterAudit}:{}),
      ...(nhlScratchAudit?{nhlScratchAudit}:{}),
      ...(nhlGoalieFormAudit?{nhlGoalieFormAudit}:{}),
      ...(nhlTeamShotsAudit?{nhlTeamShotsAudit}:{}),
      ...(nhlSkaterImpactAudit?{nhlSkaterImpactAudit}:{}),
      ...(freeInjuryChecks.length?{freeInjuryChecks}:{}),
      ...(endpointAudit?{endpointAudit}:{}),
      ...(playerHistoryAudit?{playerHistoryAudit}:{}),
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
  if(!Number.isInteger(deadlineMs)||deadlineMs<10||deadlineMs>240_000)
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
      const result=await Promise.race([
        investigateTicketSpecialist(game,guardedFetch,now,env,quotes),
        new Promise<SpecialistGate>(resolve=>{
          timer=setTimeout(()=>{
            controller.abort()
            resolve(errorResult(game,'Límite de investigación ('+deadlineMs+
              ' ms) alcanzado. Expediente condicional; comprobar la fuente antes de apostar.'))
          },deadlineMs)
        }),
      ])
      if(!result.pendingSteps.some(x=>x.includes('Límite de investigación')))
        return result
      // A late NBA Common v3/roster request must not erase the separately
      // available ESPN injury report. Recover the fast bilateral source on a
      // fresh, bounded connection even when the expensive dossier timed out.
      if(!['nba','wnba','nhl','nfl','mlb'].includes(game.league))
        return result
      const fallbackController=new AbortController()
      const rescueFetch:typeof fetch=(input,init)=>{
        const signal=init?.signal?
          AbortSignal.any([init.signal,fallbackController.signal]):
          fallbackController.signal
        return fetcher(input,{...init,signal})
      }
      let rescueTimer:ReturnType<typeof setTimeout>|undefined
      try{
        const injury=await Promise.race([
          fetchEspnInjuryBackup(game,rescueFetch,now).catch(()=>null),
          new Promise<null>(resolve=>{
            rescueTimer=setTimeout(()=>{
              fallbackController.abort()
              resolve(null)
            },8_000)
          }),
        ])
        if(!injury||!['verified','partial'].includes(injury.status))
          return result
        return{...result,status:'incomplete',
          specialist:game.sport+' · datos parciales recuperados',
          verifiedSteps:['ESPN reporte de lesiones '+injury.status+
            ' · local '+injury.home.injuries.length+
            ', visitante '+injury.away.injuries.length],
          pendingSteps:[...result.pendingSteps,
            'Investigar roster, titulares y métricas restantes sin descartar el parte ESPN',
            ...injury.notes.slice(0,3)],
          injuryAudit:injury,approvedForBetting:false}
      }finally{
        if(rescueTimer!==undefined)clearTimeout(rescueTimer)
      }
    }finally{if(timer!==undefined)clearTimeout(timer)}
  }
  const audited:SpecialistGate[]=[]
  for(let offset=0;offset<games.length;offset+=4){
    const batch=await Promise.all(games.slice(offset,offset+4).map(inspect))
    audited.push(...batch)
  }
  return audited
}
