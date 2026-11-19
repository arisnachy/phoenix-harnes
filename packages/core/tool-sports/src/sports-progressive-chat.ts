/** Progressive, model-directed pregame research for unboxed tables in chat.
 * Each stage is a distinct tool result, not an internal callback suppressed
 * until the automatic ticket has finished. Real statistics stay unweighted.
 */
import { getFeed } from './sports.ts'
import { investigateTicketSpecialist,type ComparativeTeam,type SpecialistFixture,type SpecialistGate }
  from './ticket-specialist-gate.ts'
import { collectDirectEspnStats,type DirectDossier } from './sports-direct-stats.ts'
import { investigateEventDeep,type DeepSportsContext } from './sports-deep-context.ts'
import { auditUniversalMatchup } from './universal-matchup-factors.ts'
import { lookupExactEspnWinner } from './sports-exact-espn-winner.ts'
import { ticketLeagueOddsKey } from './evidence-priced-ticket.ts'
import { discoverAutonomousSportsSources,planIndependentSportsFallback } from './sports-autonomous-source-discovery.ts'

export type ResearchStage='teams'|'rosters'|'availability'|'context'|'news'|'odds'
type Row = {
  label: string
  home: string
  away: string
  note?: string
  url?: string
  homeImage?: string
  awayImage?: string
  state?: 'verified'|'reported'|'pending'|'indexed'
}
type Club = {
  name: string
  logo?: string
}
type Table = {
  component: 'sports_research_table'
  version: 1
  props: {
    sport: string
    league: string
    eventId: string
    stage: ResearchStage
    title: string
    checkedAt: string
    source: string
    note: string
    home: Club
    away: Club
    rows: Row[]
    missing: string[]
  }
}
const text=(v:unknown,n=380):string=>{
  const s=typeof v==='string'||typeof v==='number'?String(v):''
  return s.replace(/[\u0000-\u001f|]/gu,' ').trim().slice(0,n)||'No disponible'
}
const norm=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const steps:ResearchStage[]=['teams','rosters','availability','context','news','odds']
type ResearchCache={
  observedAt:number
  deep?:Promise<DeepSportsContext|null>
  specialist?:Promise<SpecialistGate|null>
  ncaaDirect?:Promise<DirectDossier|null>
  context?:Promise<Awaited<ReturnType<typeof auditUniversalMatchup>>|null>
}
const cache=new Map<string,ResearchCache>()
const getCache=(fixture:SpecialistFixture,now:number)=>{
  const key=[fixture.sport,fixture.league,fixture.eventId,fixture.date].join('|')
  const existing=cache.get(key)
  if(existing&&now>=existing.observedAt&&now-existing.observedAt<5*60_000)return existing
  if(cache.size>80)cache.clear()
  const next:ResearchCache={ observedAt:now }
  cache.set(key,next)
  return next
}
const fresh=<T>(operation:()=>Promise<T>,maxMs:number):Promise<T|null>=>{
  let timer:ReturnType<typeof setTimeout>|undefined
  return Promise.race([operation().catch(()=>null),new Promise<null>((resolve)=>{
    timer=setTimeout(()=>resolve(null),maxMs)
  })]).finally(()=>{if(timer)clearTimeout(timer)})
}
const readDeep=(fixture:SpecialistFixture,fetcher:typeof fetch,now:number,
  env:NodeJS.ProcessEnv)=>{
  const record=fetcher===fetch?getCache(fixture,now):{ observedAt:now,
    deep:undefined as Promise<DeepSportsContext|null>|undefined }
  record.deep??=fresh(()=>investigateEventDeep(fixture.sport,fixture.league,
    fixture.eventId,fetcher,now,env),18_000)
  return record.deep
}
const readSpecialist=(fixture:SpecialistFixture,fetcher:typeof fetch,now:number,
  env:NodeJS.ProcessEnv)=>{
  const record=fetcher===fetch?getCache(fixture,now):{ observedAt:now,
    specialist:undefined as Promise<SpecialistGate|null>|undefined }
  record.specialist??=fresh(()=>investigateTicketSpecialist(fixture,fetcher,now,env),
    fixture.sport==='basketball'?125_000:90_000)
  return record.specialist
}
const readNcaaDirect=(fixture:SpecialistFixture,deep:DeepSportsContext|null,
  fetcher:typeof fetch,now:number)=>{
  const home=sideOf(deep,fixture.home),away=sideOf(deep,fixture.away)
  if(fixture.sport!=='basketball'||fixture.league!=='mens-college-basketball'||
    !home?.id||!away?.id)return Promise.resolve<DirectDossier|null>(null)
  const record=fetcher===fetch?getCache(fixture,now):{
    observedAt:now,ncaaDirect:undefined as Promise<DirectDossier|null>|undefined }
  record.ncaaDirect??=fresh(()=>collectDirectEspnStats(fixture.sport,fixture.league,
    [{ id:home.id,name:home.name },{ id:away.id,name:away.name }],fetcher,now,20),110_000)
  return record.ncaaDirect
}
const directTeamComparison=(dossier:DirectDossier,deep:DeepSportsContext|null,
  fixture:SpecialistFixture):{ home:ComparativeTeam;away:ComparativeTeam }|null=>{
  const make=(name:string)=>{
    const verified=sideOf(deep,name)
    const team=dossier.teams.find(row=>row.id===verified?.id)
    if(!team)return null
    const players=team.roster.map((person)=>{
      const measured=team.athletes.find(row=>row.id===person.id)
      return{ name:person.name,role:person.position||'Jugador',
        dataStatus:measured?('ESPN '+measured.status):'Roster ESPN; métricas no consultadas',
        starterConfirmed:false,stats:measured?.stats??[],recent:measured?.lastGames??[],
        splits:measured?.splits??[] }
    })
    return{ name:team.name,recentResults:[],teamStats:team.stats,players }
  }
  const home=make(fixture.home),away=make(fixture.away)
  return home&&away?{ home,away }:null
}
const readContext=(fixture:SpecialistFixture,fetcher:typeof fetch,now:number,
  env:NodeJS.ProcessEnv)=>{
  const record=fetcher===fetch?getCache(fixture,now):{ observedAt:now,
    context:undefined as Promise<Awaited<ReturnType<typeof auditUniversalMatchup>>|null>|undefined }
  record.context??=fresh(()=>auditUniversalMatchup({
    sport:fixture.sport,league:fixture.league,eventId:fixture.eventId,
    date:fixture.date,lookbackDays:14,includeOdds:false,
  },fetcher,now,env),110_000)
  return record.context
}
const sideOf=(deep:DeepSportsContext|null,name:string)=>deep?.teams.find(t=>
  norm(t.name)===norm(name))
const officialLogos=(fixture:SpecialistFixture,deep:DeepSportsContext|null)=>{
  const club=(name:string):Club=>{
    const logo=sideOf(deep,name)?.logo
    return logo?{ name,logo }:{ name }
  }
  return{ home:club(fixture.home),away:club(fixture.away) }
}
const rosterPortrait=(deep:DeepSportsContext|null,team:string,player:string)=>
  sideOf(deep,team)?.rosterPortraits.find(row=>norm(row.name)===norm(player))
    ?.headshot??undefined
/** Source-bound roster summary with role, availability uncertainty and venue splits. */
export const summarizeSportsPlayer=(p:NonNullable<SpecialistGate['teamComparison']>['home']['players'][number])=>
  text(p.name+' · '+p.role+' · '+(p.starterConfirmed?'titular identificado':'titular sin confirmar')+
    ' · '+text(p.dataStatus,80)+
    (p.stats.length?' · temporada: '+p.stats.slice(0,5).map(s=>s.name+': '+s.value).join('; '):'')+
    (p.splits.length?' · local/visita: '+p.splits.slice(0,2).map(s=>s.name+': '+s.value).join('; '):'')+
    (p.recent.length?' · reciente: '+p.recent.slice(0,2).map(s=>s.name+': '+s.value).join('; '):''),390)
type SportsPlayer=NonNullable<SpecialistGate['teamComparison']>['home']['players'][number]
const playerSummary=(player:SportsPlayer):SportsPlayer=>({
  ...player,recent:player.recent.slice(0,2).map(metric=>({
    name:metric.name,value:metric.value.slice(0,180),
  })),splits:player.splits.slice(0,4),
})
const state=(ok:boolean):'verified'|'pending'=>ok?'verified':'pending'
const pair=(label:string,home:unknown,away:unknown,verified=true):Row=>({
  label:text(label,155),home:text(home),away:text(away),state:state(verified),
})
const missingArray=(rows:readonly string[])=>rows.filter(Boolean).slice(0,14)
const formatGame=(g:{ opponent:string;scored:number;allowed:number;homeAway:string;date:string })=>
  g.date.slice(0,10)+' · '+g.opponent+' '+g.scored+'-'+g.allowed+
  ' ('+(g.homeAway==='home'?'local':'visitante')+')'
type StageResult={
  uiBlock:Table
  stage:ResearchStage
  nextStage:ResearchStage|null
  nextPlayerOffset:number|null
  sourceEscalation:ReturnType<typeof planIndependentSportsFallback>|null
  evidence:unknown
  missing:string[]
  instruction:string
}
/** Emit one sourced stage. The LLM can narrate or challenge it before requesting
 * the next stage, so the user observes the investigation in the chat itself.
 * @param fixture - ESPN fixture to research.
 * @param stage - One step of the bilateral comparison.
 * @param question - Optional editorial discovery question.
 * @param fetcher - Public-source transport.
 * @param now - Pregame observation time.
 * @param env - Provider configuration.
 * @param playerOffset - Zero-based roster page offset.
 * @param fullPlayerHistory - Return all recovered metrics for one player on each side.
 * @returns Sourced evidence and guidance for the next step.
 */
export async function progressiveSportsStage(
  fixture:SpecialistFixture,stage:ResearchStage,
  question:string|undefined,fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,playerOffset=0,fullPlayerHistory=false,
):Promise<StageResult>{
  if(!/^\d{1,18}$/u.test(fixture.eventId)||
    !/^\d{4}-\d{2}-\d{2}$/u.test(fixture.date)||
    !Number.isFinite(Date.parse(fixture.kickoff))||
    Date.parse(fixture.kickoff)<=now||
    !steps.includes(stage)||
    !Number.isInteger(playerOffset)||playerOffset<0||playerOffset>250||
    (stage!=='rosters'&&(playerOffset!==0||fullPlayerHistory))||
    !fixture.home.trim()||!fixture.away.trim())
    throw Error('La investigación gradual necesita dos equipos y un partido futuro con ID ESPN verificado')
  const deep=await readDeep(fixture,fetcher,now,env)
  const clubs=officialLogos(fixture,deep)
  let rows:Row[]=[],evidence:unknown=null,source='ESPN Site API'
  let missing:string[]=[]
  let nextPlayerOffset:number|null=null
  let note='Datos publicados; ninguna tabla es un pronóstico automático.'
  if(stage==='teams'){
    const venue=deep?.venue?.name||'No verificado'
    const weather=deep?.weather
    rows=[
      pair('Equipos contrastados por ID ESPN',
        sideOf(deep,fixture.home)?.name??'Pendiente',
        sideOf(deep,fixture.away)?.name??'Pendiente',Boolean(deep?.teams.length===2)),
      pair('Plantillas recuperadas (muestra ESPN)',
        String(sideOf(deep,fixture.home)?.rosterSample.length??'No disponible'),
        String(sideOf(deep,fixture.away)?.rosterSample.length??'No disponible'),
        Boolean(deep?.teams.length===2)),
      pair('Sede',venue,venue,Boolean(deep?.venue?.name)),
      pair('Clima / techo',weather?.description??'Sin pronóstico',
        weather?.description??'Sin pronóstico',weather?.status==='verified'||
          weather?.status==='not-applicable'),
      pair('Oficiales publicados',deep?.officials?.map(o=>o.name+' · '+o.role).join('; ')
        ||'Sin árbitros confirmados',deep?.officials?.map(o=>o.name+' · '+o.role).join('; ')
        ||'Sin árbitros confirmados',Boolean(deep?.officials?.length)),
    ]
    evidence=deep
    missing=deep?.limitations??['Resumen ESPN sin expediente verificable']
    note='Árbitro, ampáyer o clima sin estudio causal no demuestra ventaja. '+
      'El clima exterior no afecta automáticamente a recintos cubiertos.'
  }else if(stage==='rosters'){
    const check=await readSpecialist(fixture,fetcher,now,env)
    let data=check?.teamComparison
    let ncaaDirect:DirectDossier|null=null
    if(!data&&fixture.sport==='basketball'&&fixture.league==='mens-college-basketball'){
      ncaaDirect=await readNcaaDirect(fixture,deep,fetcher,now)
      if(ncaaDirect)data=directTeamComparison(ncaaDirect,deep,fixture)??undefined
    }
    const pageSize=fullPlayerHistory?1:6
    const page=(players:readonly SportsPlayer[])=>{
      const selected=players.slice(playerOffset,playerOffset+pageSize)
      return fullPlayerHistory?selected:selected.map(playerSummary)
    }
    const measured=(side:'home'|'away')=>data?.[side].players.filter(p=>
      p.stats.length>0||p.recent.length>0||p.splits.length>0).length??0
    rows=[
      pair('Jugadores en plantilla (no confirman participación)',
        data?String(data.home.players.length)+' jugadores':'Sin plantilla',
        data?String(data.away.players.length)+' jugadores':'Sin plantilla',
        Boolean(data?.home.players.length&&data.away.players.length)),
      pair('Jugadores con estadísticas individuales observadas',
        String(measured('home'))+' de '+String(data?.home.players.length??0),
        String(measured('away'))+' de '+String(data?.away.players.length??0),
        Boolean(measured('home')&&measured('away'))),
    ]
    if(data){
      const stats=[...new Set([...data.home.teamStats.map(x=>x.name),
        ...data.away.teamStats.map(x=>x.name)])].slice(0,8)
      for(const key of stats){
        rows.push(pair(text(key,120),
          data.home.teamStats.find(x=>x.name===key)?.value??'No publicado',
          data.away.teamStats.find(x=>x.name===key)?.value??'No publicado'))
      }
      const athletes=Math.max(data.home.players.length,data.away.players.length)
      const end=Math.min(athletes,playerOffset+pageSize)
      nextPlayerOffset=end<athletes?end:null
      for(let i=playerOffset;i<end;i++){
        const home=data.home.players[i],away=data.away.players[i]
        const homeImage=home?rosterPortrait(deep,fixture.home,home.name):undefined
        const awayImage=away?rosterPortrait(deep,fixture.away,away.name):undefined
        rows.push({ label:'Jugador '+String(i+1)+' · filas paralelas',
          home:home?summarizeSportsPlayer(home):'Sin jugador en esta fila',
          away:away?summarizeSportsPlayer(away):'Sin jugador en esta fila',
          ...(homeImage?{ homeImage }:{}),...(awayImage?{ awayImage }:{}),
          state:'reported' })
      }
    }
    evidence={ teamComparison:data?{
      home:{ name:data.home.name,players:page(data.home.players) },
      away:{ name:data.away.name,players:page(data.away.players) },
    }:null,playerOffset,nextPlayerOffset,fullPlayerHistory,checkedAt:check?.checkedAt,
    playerHistoryAudit:check?.playerHistoryAudit??null,
    ...(ncaaDirect?{ directEspnDossier:ncaaDirect }:{} ) }
    missing=[...(check?.pendingSteps??['El especialista no publicó su expediente'])]
    if(ncaaDirect)missing=missing.filter(x=>!x.includes('Sin especialista integrado'))
    if(!data||measured('home')<data.home.players.length||measured('away')<data.away.players.length)
      missing.push('Estadísticas individuales de uno o ambos rosters incompletas: '+
        'consultar temporada explícita y fuentes originales independientes')
    if(ncaaDirect)missing.push('NCAA: estadísticas individuales consultadas para una muestra acotada de hasta 20 atletas por equipo; el roster restante conserva métricas no consultadas')
    source=ncaaDirect?'ESPN public Site/Common v3 · fallback NCAA':
      check?.specialist??'Investigación especializada no disponible'
    note='Las filas de jugadores son paralelas y NO constituyen emparejamientos directos. '+
      'Se preservan las estadísticas completas en el expediente para Kira; las '+
      'cifras visibles son un resumen, sin pesos ni puntuación sintética. '+
      (nextPlayerOffset===null?'Última página de la plantilla publicada.':
        'Continúa con playerOffset='+nextPlayerOffset+' para comparar más jugadores.')
  }else if(stage==='availability'){
    const check=await readSpecialist(fixture,fetcher,now,env)
    const injury=check?.injuryAudit
    const home=injury?.home.injuries??[],away=injury?.away.injuries??[]
    rows=[pair('Parte de lesiones ESPN',
      injury?.home.matched?'Equipo reconocido en reporte':'Sin conciliación completa',
      injury?.away.matched?'Equipo reconocido en reporte':'Sin conciliación completa',
      Boolean(injury?.home.matched&&injury?.away.matched))]
    for(let i=0;i<Math.max(1,Math.min(30,Math.max(home.length,away.length)));i++){
      const h=home[i],a=away[i]
      rows.push(pair('Disponibilidad publicada '+String(i+1),
        h?h.athlete+' · '+h.status+' · '+(h.reportedAt??'sin fecha'):'Sin registro verificado',
        a?a.athlete+' · '+a.status+' · '+(a.reportedAt??'sin fecha'):'Sin registro verificado',
        Boolean(h?.reportedAt&&a?.reportedAt)))
    }
    const starters=check?.checklist?.steps.filter(s=>
      /goalie|portero|qb|quarterback|starters|titular|pitcher|abridor|lineup|once|quinteto/iu.test(
        s.key+' '+s.title))??[]
    for(const step of starters.slice(0,9))rows.push(pair(
      'Estado: '+step.title,step.detail,step.detail,step.state==='verified'))
    if(fixture.sport==='hockey'){
      const probe=check?.nhlStarterAudit
      rows.push(pair('Porteros titulares oficiales NHL',
        probe?.homeGoalie??'Por confirmar',
        probe?.awayGoalie??'Por confirmar',probe?.state==='confirmed'))
      const scratches=check?.nhlScratchAudit
      rows.push(pair('NHL · scratches publicados (no alineación definitiva)',
        scratches?.state==='observed'?String(scratches.home.length)+' registros':'No publicados',
        scratches?.state==='observed'?String(scratches.away.length)+' registros':'No publicados',
        scratches?.state==='observed'))
      const goalies=check?.nhlGoalieFormAudit
      for(let i=0;i<Math.min(3,Math.max(goalies?.home.length??0,
        goalies?.away.length??0));i++){
        const h=goalies?.home[i],a=goalies?.away[i]
        const describe=(g:typeof h)=>g?g.name+' · temporada SV% '+
          (g.seasonSavePct===null?'no publicado':String(g.seasonSavePct))+
          ' · últimos registros SV% '+(g.recentSavePct===null?
          'sin muestra':String(g.recentSavePct)):'Sin registro'
        rows.push(pair('NHL · candidato a portero '+String(i+1),
          describe(h),describe(a),false))
      }
    }
    if(fixture.sport==='baseball'){
      const pitchers=(side:'home'|'away')=>check?.teamComparison?.[side].players
        .filter(p=>/(?:pitcher|lanzador|abridor|relief|bullpen)/iu.test(p.role)||
          ['SP','RP','P'].some(pos=>p.role.toUpperCase().split(/[^A-Z]+/u).includes(pos)))
        .slice(0,6)??[]
      const homePitchers=pitchers('home'),awayPitchers=pitchers('away')
      rows.push(pair('MLB · lanzadores en roster (no abridores confirmados)',
        homePitchers.length+' perfiles publicados',awayPitchers.length+' perfiles publicados',
        Boolean(homePitchers.length&&awayPitchers.length)))
      const describe=(p:typeof homePitchers[number]|undefined)=>p?
        p.name+' · '+p.role+' · '+p.stats.slice(0,3).map(s=>s.name+': '+s.value).join('; '):
        'Sin lanzador verificado'
      for(let i=0;i<Math.min(6,Math.max(homePitchers.length,awayPitchers.length));i++)
        rows.push(pair('MLB · lanzador '+String(i+1),
          describe(homePitchers[i]),describe(awayPitchers[i]),false))
      missing.push('MLB: cotejar los abridores probables y el bullpen en la etapa de contexto')
    }
    evidence={ injuryAudit:injury??null,rosterMatchedInjuries:check?.rosterMatchedInjuries,
      goalie:check?.nhlStarterAudit??null,scratches:check?.nhlScratchAudit??null,
      goalieForm:check?.nhlGoalieFormAudit??null,
      skaterStats:check?.nhlSkaterImpactAudit??null,
      checklist:check?.checklist??null }
    missing=check?.pendingSteps??['Titulares y bajas sin comprobación especializada']
    note='Roster no es lista de titulares. Questionable y probable NO significan '+
      'inactivo confirmado; la ausencia de registros NO equivale a equipo sano.'
  }else if(stage==='context'){
    const [context,check]=await Promise.all([
      readContext(fixture,fetcher,now,env),readSpecialist(fixture,fetcher,now,env)])
    if(context){
      const h=context.home.form,a=context.away.form
      rows=[
        pair('Últimos encuentros recuperados',
          h.games+' juegos · '+h.wins+'V '+h.losses+'D '+h.draws+'E',
          a.games+' juegos · '+a.wins+'V '+a.losses+'D '+a.draws+'E'),
        pair('Producción y concesión por partido',
          text(h.scoredPerGame)+' a favor; '+text(h.allowedPerGame)+' en contra',
          text(a.scoredPerGame)+' a favor; '+text(a.allowedPerGame)+' en contra',
          Boolean(h.games&&a.games)),
        pair('Último juego registrado',
          context.home.lastGames[0]?formatGame(context.home.lastGames[0]):'Sin registro',
          context.away.lastGames[0]?formatGame(context.away.lastGames[0]):'Sin registro',
          Boolean(h.games&&a.games)),
        pair('Descanso prepartido',
          check?.restHours?.home===null||check?.restHours?.home===undefined?
            'No documentado':String(check.restHours.home)+' horas',
          check?.restHours?.away===null||check?.restHours?.away===undefined?
            'No documentado':String(check.restHours.away)+' horas',
          Boolean(check?.restHours?.home&&check?.restHours?.away)),
        pair('Sede del partido',context.stadium.name||'No publicada',
          context.stadium.name||'No publicada',Boolean(context.stadium.name)),
        pair('Enfrentamientos en esta sede, ventana investigada',
          context.stadium.homeAtVenue===null?'Sin datos':String(context.stadium.homeAtVenue),
          context.stadium.awayAtVenue===null?'Sin datos':String(context.stadium.awayAtVenue),
          context.stadium.homeAtVenue!==null&&context.stadium.awayAtVenue!==null),
        pair('Pronóstico horario',context.weather?
          context.weather.dayNight+' · '+text(context.weather.temperatureC)+' °C · viento '+
          text(context.weather.windKmh)+' km/h':'No verificado',
        context.weather?'Lluvia '+text(context.weather.precipitationProbability)+
          '% · Open-Meteo':'No verificado',Boolean(context.weather)),
      ]
      for(const g of context.headToHead.slice(0,5))rows.push(pair(
        'Antecedente directo '+g.date.slice(0,10),
        g.home+' '+text(g.homeScore),g.away+' '+text(g.awayScore),true))
      const records=(games:Array<Parameters<typeof formatGame>[0]>,location:'home'|'away')=>{
        const subset=games.filter(g=>g.homeAway===location)
        return subset.length?String(subset.filter(g=>g.scored>g.allowed).length)+
          ' victorias / '+String(subset.length)+' juegos':'Sin muestra'
      }
      rows.push(pair('Histórico reciente jugando como LOCAL',
        records(context.home.lastGames,'home'),
        records(context.away.lastGames,'home'),
        Boolean(context.home.lastGames.length&&context.away.lastGames.length)))
      rows.push(pair('Histórico reciente jugando como VISITANTE',
        records(context.home.lastGames,'away'),
        records(context.away.lastGames,'away'),
        Boolean(context.home.lastGames.length&&context.away.lastGames.length)))
      for(let i=0;i<Math.min(6,Math.max(context.home.lastGames.length,
        context.away.lastGames.length));i++){
        const homeGame=context.home.lastGames[i]
        const awayGame=context.away.lastGames[i]
        rows.push(pair('Resultado reciente '+String(i+1),
          homeGame?formatGame(homeGame):'Sin registro',
          awayGame?formatGame(awayGame):'Sin registro',true))
      }
      for(const duel of (check?.playerMatchups??[]).slice(0,8))rows.push({
        label:'Cruce jugador-rival · '+(duel.status==='observed'?'histórico':'posible'),
        home:text(duel.athlete+' · '+duel.detail,380),
        away:text(duel.opponent),note:text(duel.source,340),
        state:duel.status==='observed'?'verified':'pending',
      })
      if(fixture.sport==='baseball'){
        const homeStarter=context.mlb.probableStarters.find(p=>p.team==='home')
        const awayStarter=context.mlb.probableStarters.find(p=>p.team==='away')
        rows.push(pair('MLB · abridor probable (MLB StatsAPI)',
          homeStarter?.name??'No publicado',awayStarter?.name??'No publicado',
          Boolean(homeStarter&&awayStarter)))
        const recent=(p:typeof homeStarter)=>p?.outings.length?
          p.outings.slice(0,3).map(o=>o.date+' · '+o.inningsPitched+
            ' IP · '+o.earnedRuns+' CL').join('; '):'Sin aperturas comprobadas'
        rows.push(pair('MLB · últimas aperturas del pitcher probable',
          recent(homeStarter),recent(awayStarter),
          Boolean(homeStarter?.outings.length&&awayStarter?.outings.length)))
      }
    }else rows=[pair('Histórico y comparativa por sede',
      'No publicado','No publicado',false)]
    evidence={ matchup:context?{
      home:context.home,away:context.away,headToHead:context.headToHead,
      stadium:context.stadium,weather:context.weather,mlb:context.mlb,
      coverage:context.coverage,limitations:context.limitations,
    }:null,playerMatchups:check?.playerMatchups??null,
    checklist:check?.checklist??null }
    missing=context?.limitations??['Históricos y sede no recuperados']
    source='ESPN históricos · Open-Meteo · MLB oficial cuando corresponda'
    note='Balance local/visitante, antecedentes y clima son datos contextuales, NO '+
      'pruebas de efecto del estadio, umpires ni predicción numérica de victoria.'
  }else if(stage==='news'){
    const query=question?.trim()||'injury starters roster preview'
    const [discovery,check]=await Promise.all([
      discoverAutonomousSportsSources({ home:fixture.home,away:fixture.away },
        query,fetcher,now),readSpecialist(fixture,fetcher,now,env)])
    const reports=check?.newsFindings??[]
    rows=deep?.eventArticle?[{
      label:'ESPN · artículo vinculado al evento',
      home:text(deep.eventArticle.headline),
      away:text(deep.eventArticle.source+' · '+deep.eventArticle.published),
      note:text(deep.eventArticle.excerpt,380),url:deep.eventArticle.articleUrl,
      state:'reported' as const,
    }]:[]
    rows.push(...(deep?.headlines??[]).slice(0,8).map((row,i)=>({
      label:'ESPN News · '+String(i+1),
      home:text(row.headline),away:text('ESPN · '+row.published),
      ...(row.articleUrl?{ url:row.articleUrl }:{}),state:'reported' as const,
    })))
    rows.push(...reports.slice(0,8).map((row,i)=>({
      label:'Otra fuente '+String(i+1),home:text(row.title),
      away:text(row.publisher+' · '+(row.publishedAt??'sin fecha confirmada')),
      state:row.status==='indexed-headline-only'?'indexed' as const:'reported' as const,
    })))
    rows.push(...discovery.articles.slice(0,12).map((article,i)=>({
      label:'Fuente descubierta '+String(i+1),home:text(article.title),
      away:text(article.publisher+' · índice '+article.indexedAt),
      url:article.articleUrl,state:'indexed' as const,
    })))
    if(!rows.length){
      rows=[pair('Noticias y expertos',
        'Sin artículo publicado accesible','Sin artículo contrastado',false)]
      missing.push('Noticias del encuentro: sin publicación original contrastada')
    }
    evidence={ question:query,espnHeadlines:deep?.headlines??[],eventArticle:deep?.eventArticle??null,
      indexedArticles:discovery.articles,
      publisherNotes:reports,warning:discovery.limitation }
    if(discovery.status==='unavailable')missing.push(discovery.limitation)
    source='ESPN News · GDELT (cualquier medio público indexado)'
    note='Titular, mención o pronóstico de un experto NO confirma noticia, alineación '+
      'ni elección. Kira abre y contrasta la publicación antes de usarla.'
  }else if(stage==='odds'){
    const key=ticketLeagueOddsKey(fixture,'dynamic')
    const result=key?await fresh(()=>lookupExactEspnWinner({
      sportKey:key,eventId:fixture.eventId,date:fixture.date,
      home:fixture.home,away:fixture.away,kickoff:fixture.kickoff,
      ...(fixture.sport==='soccer'?{ espnLeague:fixture.league }:{}),
    },<T>(url:string)=>getFeed<T>(url,fetcher),now),20_000):null
    const quotes=result?.quotes??[]
    rows=quotes.slice(0,28).map((q)=>{
      const homeSelected=norm(q.selection)===norm(fixture.home)
      const awaySelected=norm(q.selection)===norm(fixture.away)
      const thirdOutcome=!homeSelected&&!awaySelected
      return{
        label:text(q.bookmaker+' · '+q.market+(thirdOutcome?' · Tercer resultado':''),145),
        home:homeSelected?String(q.price):'—',
        away:awaySelected?String(q.price):'—',
        note:text(q.selection+' · '+(thirdOutcome?'cuota '+String(q.price)+' · ':'')+
          'observado '+(q.observedAt??q.updatedAt),340),
        state:'verified' as const,
      }
    })
    if(!rows.length)rows=[pair('Cuotas ESPN por casa', 'Sin precio verificado',
      'Sin precio verificado',false)]
    evidence={ quotes,source:result?.source??'ESPN no observado',
      notes:result?.notes??[],referenceOdds:result?.referenceOdds??[] }
    missing=quotes.length?[]:['ESPN no devolvió una cuota comercial cotejable con este evento']
    source=result?.source??'ESPN Site/Core'
    note='Cuotas comerciales observadas por PHOENIX: sin exigir updatedAt '+
      'si observedAt es reciente. Empate 1X2 se conserva como selección separada '+
      'en evidence.quotes. No se hizo ninguna apuesta ni se promete acertar.'
  }
  const index=steps.indexOf(stage)
  const card:Table={ component:'sports_research_table',version:1,props:{
    sport:fixture.sport,league:fixture.league,eventId:fixture.eventId,
    stage,title:fixture.away+' vs '+fixture.home,
    checkedAt:new Date(now).toISOString(),source:text(source,230),
    note:text(note,800),home:clubs.home,away:clubs.away,
    rows:rows.slice(0,64),missing:missingArray(missing.map(x=>text(x,225))),
  } }
  const unresolved=card.props.missing.length>0||
    stage==='news'&&!rows.some(row=>row.state==='verified')
  const sourceEscalation=unresolved&&
    (stage==='rosters'||stage==='availability'||stage==='context'||stage==='news')?
    planIndependentSportsFallback({
      home:fixture.home,away:fixture.away,league:fixture.league,date:fixture.date,
      question:question?.trim()||card.props.missing[0]||
        (stage==='rosters'?'estadísticas individuales temporada y últimos partidos':
          stage==='availability'?'titulares lesiones y porteros':
            stage==='context'?'forma y estadísticas locales':'noticias e inactivos'),
    }):null
  return{ uiBlock:card,stage,nextStage:nextPlayerOffset===null?steps[index+1]??null:'rosters',
    nextPlayerOffset,
    sourceEscalation,
    evidence,missing:card.props.missing,
    instruction:'Kira: MUESTRA YA esta tabla en el chat y explica comparativamente '+
      'dos o tres observaciones verificadas. Luego continúa a la siguiente etapa '+
      'sin esperar a que todo el ticket termine. Si un dato falta, puedes '+
      'consultar sports_chat_autonomous_sources u otro especialista; no completes '+
      'vacíos inventando hechos. Si sourceEscalation está presente, BUSCA en las '+
      'fuentes externas indicadas y LEE sus originales mediante navegador, no te '+
      'detengas por fallo de ESPN/GDELT. Compara liga, prensa y segundo proveedor; '+
      'ningún enlace no leído certifica hechos. No atribuyas puntajes ni pesos a jugadores, '+
      'equipos o lesiones. ESPN aporta datos y precios observados; TU razonamiento '+
      'selecciona cada pata después de investigar las seis etapas.' }
}
