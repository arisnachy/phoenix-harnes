/** Evidence-first multi-sport pregame ticket research.
 * Stronger than simple win-loss record sorting, but intentionally NOT a calibrated
 * probability model. Event existence and kickoff are re-verified by researchTicket.
 */
import { getFeed,hasSportsPermission, type ChatBlock } from './sports.ts'
import { researchSport } from './multi-sport-research.ts'
import { researchTicket, type ResearchTicketLeg } from './research-ticket.ts'
const defaultLeagues = [
  ['basketball','nba'],['hockey','nhl'],['baseball','mlb'],['football','nfl'],
  ['soccer','eng.1'],['soccer','esp.1'],['soccer','usa.1'],['soccer','uefa.champions'],
  ['basketball','wnba'],['tennis','atp'],['tennis','wta'],
] as const
const dayNow=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const validDate=(day:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(day)
  &&Number.isFinite(Date.parse(day+'T00:00:00Z'))
  &&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day
const percent=(w:number,g:number)=>(w+1)/(g+2)
export async function evidenceTicket(
  count:number,date=dayNow(),sportFilter?:string,fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,
):Promise<{card:ChatBlock;complete:boolean;verifiedEvents:number;
  candidatesEvaluated:number;researchLeagues:number;modelProbabilities:false;priced:false;placed:false;
  insufficientEvidence:number;researchStandard:string;
  selections:ResearchTicketLeg[];events:Array<{eventId:string;home:string;away:string;kickoff:string;sport:string;league:string;pick:'home'|'away'}>}>{
  if(!Number.isInteger(count)||count<1||count>6)throw Error('El ticket requiere entre 1 y 6 patas')
  if(!validDate(date))throw Error('Fecha de ticket inválida')
  if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado por el operador')
  const leagues=defaultLeagues.filter(([sport])=>!sportFilter||sport===sportFilter)
  if(!leagues.length)throw Error('Disciplina sin cobertura para ticket automático')
  const slate=await Promise.allSettled(leagues.map(async([sport,league])=>{
    const board=await getFeed<{events?:Array<{date?:string;status?:{type?:{state?:string}}}>}>(
      'https://site.api.espn.com/apis/site/v2/sports/'+sport+'/'+league+
      '/scoreboard?dates='+date.replaceAll('-',''),fetcher)
    if(!Array.isArray(board.events))throw Error('Cartelera no verificada')
    const active=board.events.filter(e=>{
      const at=Date.parse(e.date??'')
      return Number.isFinite(at)&&at>now&&
        (e.status?.type?.state??'pre')==='pre'
    }).length
    return{sport,league,active}
  }))
  const eligible=slate.flatMap(r=>r.status==='fulfilled'&&r.value.active>0?[r.value]:[])
  eligible.sort((a,b)=>b.active-a.active||a.sport.localeCompare(b.sport))
  // Scan a bounded slate of six leagues, in batches of three. NFL needs
  // several weeks to collect three real matches; soccer typically needs 21 days.
  // Only verified future event IDs can ever be promoted to ticket legs.
  const shortlist=eligible.slice(0,6)
  const reports:Array<PromiseSettledResult<Awaited<ReturnType<typeof researchSport>>>>=[]
  for(let offset=0;offset<shortlist.length;offset+=3){
    const batch=await Promise.allSettled(shortlist.slice(offset,offset+3).map(({sport,league})=>
      researchSport(sport,league,date,fetcher,now,env,
        sport==='football'?28:sport==='soccer'?28:sport==='tennis'?28:21)))
    reports.push(...batch)
  }
  const candidateLegs:Array<{pick:ResearchTicketLeg;rank:number;home:string;away:string;kickoff:string}>=[]
  let evaluated=0
  let insufficientEvidence=0
  for(const report of reports){
    if(report.status!=='fulfilled')continue
    for(const match of report.value.matches){
      evaluated++
      // Three different fixtures are a lower bound for descriptive research,
      // NOT enough to sell a high-confidence 5/6-leg multi-sport parlay.
      // Only NFL retains 3 because a league schedule has one match per week.
      const minGames=match.sport==='football'?3:5
      if(match.evidence!=='descriptive'
        ||match.home.completedGames<minGames||match.away.completedGames<minGames){
        insufficientEvidence++
        continue
      }
      const home=match.home,away=match.away
      if(home.averageMargin===null||away.averageMargin===null||home.averageScored===null||away.averageScored===null)continue
      const winDiff=percent(home.wins,home.completedGames)-percent(away.wins,away.completedGames)
      // Scaled by sport-specific observed scoring rather than equating NBA point margins with soccer goals.
      const scale=Math.max(1,(home.averageScored+away.averageScored)/2)
      const marginDiff=Math.max(-1,Math.min(1,(home.averageMargin-away.averageMargin)/(2*scale)))
      const restDiff=Math.max(-1,Math.min(1,((home.restHours??0)-(away.restHours??0))/72))
      // Conservative descriptive ranking, not a probability model. At least
      // five distinct, scored games on EACH side for all non-NFL disciplines.
      // Avoid a spurious lean when the margin and win-rate contradict.
      if(Math.abs(winDiff)<0.08||Math.sign(winDiff)!==Math.sign(marginDiff)){
        insufficientEvidence++
        continue
      }
      const rank=0.55*winDiff+0.40*marginDiff+0.05*restDiff
      if(Math.abs(rank)<0.16){
        insufficientEvidence++
        continue
      }
      const favorite=rank>0?home:away,opponent=rank>0?away:home
      const sportRisks:Record<string,string>={
        soccer:'once/lesiones y xG',basketball:'lesiones y rotaciones',
        baseball:'abridores y bullpen',football:'QB y bajas',
        hockey:'portero titular',tennis:'superficie y molestias físicas',
      }
      const observed=(side:typeof favorite)=>side.lastResults.slice(0,3).map(g=>
        g.date.slice(5,10)+' '+g.scored+'-'+g.allowed+' '+g.opponent.slice(0,14)).join('; ')
      const rationale=('ESPN '+favorite.completedGames+' partidos distintos: '+
        favorite.name+' '+favorite.wins+'V-'+favorite.draws+'E-'+favorite.losses+'D; '+
        opponent.name+' '+opponent.wins+'V-'+opponent.draws+'E-'+opponent.losses+'D. '+
        'Últimos: '+observed(favorite)+'. '+
        'Márgenes '+favorite.averageMargin+'/'+opponent.averageMargin+
        '; descanso '+(favorite.restHours??'?')+'h. '+
        'POR VERIFICAR: '+(sportRisks[match.sport]??'titulares')+
        ' y cuota; sin probabilidad validada.').slice(0,240)
      candidateLegs.push({rank:Math.abs(rank),home:home.name,away:away.name,kickoff:match.date,pick:{
        sport:match.sport,league:match.league,eventId:match.eventId,
        pick:rank>0?'home':'away',rationale,
      }})
    }
  }
  candidateLegs.sort((a,b)=>b.rank-a.rank||a.pick.eventId.localeCompare(b.pick.eventId))
  const selected=candidateLegs.slice(0,count)
  const chosen=selected.map(x=>x.pick)
  if(!chosen.length)throw Error('No hay encuentros con suficiente evidencia reciente para un ticket responsable')
  const ticket=await researchTicket(chosen,date,fetcher,now,env,count,true)
  return{card:ticket.card,complete:ticket.complete,verifiedEvents:ticket.verifiedEvents,
    candidatesEvaluated:evaluated,researchLeagues:reports.filter(r=>r.status==='fulfilled').length,
    insufficientEvidence,
    researchStandard:'Preselección exigente con 5 eventos históricos por equipo (NFL: 3), resultados ESPN únicos, margen y descanso. Lesiones, titulares y cuotas siguen sin verificarse; no es una predicción calibrada.',
    modelProbabilities:false,priced:false,placed:false,selections:chosen,
    events:selected.map(x=>({eventId:x.pick.eventId,home:x.home,away:x.away,kickoff:x.kickoff,
      sport:x.pick.sport,league:x.pick.league,pick:x.pick.pick==='home'?'home' as const:'away' as const}))}
}
