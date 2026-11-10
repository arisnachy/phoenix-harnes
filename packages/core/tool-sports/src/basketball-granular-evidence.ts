/** Granular, evidence-backed NBA/WNBA checklist mapper.
 * A generic "team statistics" response never proves shooting/pace/on-off.
 * The original 12-step method is populated only from the exact observed fields.
 */
import type {BasketballCase} from './basketball-evidence-dossier.ts'
import type {StepObservation} from './daily-specialist-checklist.ts'

const numeric=(v:string):boolean=>v.trim()!==''&&Number.isFinite(Number(v.replace(/,/gu,'')))
const take=(stats:readonly {name:string;value:string}[],pattern:RegExp)=>{
  const found=stats.find(x=>pattern.test(x.name)&&numeric(x.value))
  return found?found.name+' '+found.value:null
}
const main={
  off:/^(?:offensive\s*(?:rating|efficiency)|offrtg|ortg)$/iu,
  def:/^(?:defensive\s*(?:rating|efficiency)|defrtg|drtg)$/iu,
  net:/^(?:net\s*(?:rating|efficiency)|netrtg|nrtg)$/iu,
  pace:/^(?:pace|possessions\s*per\s*(?:48|40)\s*minutes)$/iu,
} as const
const other=[
  /points\s*(?:per|allowed|against|scored)|pts/i,
  /effective.*(?:field|shoot)|efg/i,/true.*shoot|ts%/i,
  /turnover|tov/i,/offensive.*rebound|orb/i,
  /defensive.*rebound|drb/i,/free.*throw|ft/i,/three.*point|3p/i,
]
const text=(parts:(string|null)[])=>parts.filter(Boolean).join(' · ').slice(0,900)
const entry=(state:StepObservation['state'],detail:string):StepObservation=>({
  state,detail:detail.slice(0,900),
})
export function auditBasketballGranularEvidence(d:BasketballCase):
  Record<string,StepObservation>{
  const h=d.teams.home,a=d.teams.away, both=[h,a] as const
  const hasVenue=Boolean(d.venue&&d.venue.trim()&&
    !/sede sin verificar|no verificado|unknown|sin sede/iu.test(d.venue))
  const identified=Boolean(d.fixture.eventId&&h.name&&a.name&&
    Number.isFinite(Date.parse(d.fixture.start)))
  const formCounts=both.map(x=>x.lastGames.length)
  const formText=both.map(x=>x.name+': '+x.lastGames.length+' juegos; '+
    x.wins+' V/'+x.losses+' D').join(' | ')
  const fullHistory=formCounts.every(n=>n>=20)
  const someHistory=formCounts.every(n=>n>=5)
  const four=both.map(x=>Object.entries(main).map(([key,re])=>
    key+'='+(take(x.teamStats,re)??'sin dato')))
  const fourComplete=both.every(x=>Object.values(main).every(re=>
    take(x.teamStats,re)!==null))
  const fourAny=both.some(x=>Object.values(main).some(re=>
    take(x.teamStats,re)!==null))
  const shooting=both.map(x=>other.map(re=>take(x.teamStats,re)))
  const shootingAny=shooting.some(metrics=>metrics.some(Boolean))
  const playersWithStats=both.map(x=>x.roster.filter(p=>p.stats.length>0))
  const playersWithGames=both.map(x=>x.roster.filter(p=>p.lastGames.length>0))
  const playerDetail=both.map((x,i)=>x.name+': '+playersWithStats[i]!.length+
    ' jugadores con estadísticas; '+playersWithGames[i]!.length+
    ' con gamelog').join(' | ')
  const confirmed=both.every(x=>x.quintetConfirmed)
  const rest=both.map((x,i)=>d.context.restHours[i ? 'away' : 'home']))
  const bothRest=rest.every(x=>x!==null)
  const h2h=d.context.h2h
  const results:Record<string,StepObservation>={}
  results.U01=entry(identified&&hasVenue?'verified':identified?'partial':'missing',
    'ESPN identidad '+d.fixture.eventId+'; '+a.name+' vs '+h.name+
    '; arena '+(d.venue||'sin verificar')+'; '+d.fixture.start)
  results.B01=results.U01
  results.U02=entry(someHistory?'partial':'missing',
    formText+'; calendario completo/20 y dificultad de rivales pendientes cuando corresponda')
  results.B02=entry(fullHistory?'verified':someHistory?'partial':'missing',
    formText+'; ventana de 5/10/20 juegos exigida')
  results.B03=entry(someHistory?'partial':'missing',
    'Partidos observados; fuerza de rival, home/away y ajuste de calendario '+ 
    'requieren métricas separadas. '+formText)
  results.B04=entry(fourComplete?'verified':fourAny?'partial':'missing',
    both.map((x,i)=>x.name+': '+four[i]!.join(', ')).join(' | '))
  results.B05=entry(shootingAny?'partial':'missing',
    both.map((x,i)=>x.name+': '+text(shooting[i]!)).join(' | ')+
    '; exige PTS, eFG, TS, pérdidas, ORB/DRB, FT y triples')
  results.U03=entry(fourAny||shootingAny?'partial':'missing',
    'Desglose comprobado de B04 y B05; no inferir cifras ausentes')
  results.B06=entry(playersWithStats.every(x=>x.length>0)?'partial':'missing',
    playerDetail+'; faltan USG, TS, minutos y figura principal verificados')
  results.U04=entry(playersWithStats.every(x=>x.length>0)?'partial':'missing',
    playerDetail+'; enfrentamiento individual no comprobado')
  results.B07=entry(confirmed?'partial':both.every(x=>x.roster.length>0)?
    'partial':'missing','Quintetos '+(confirmed?'confirmados':'no confirmados')+
    '; rotación y on/off con y sin titulares NO certificados')
  results.B09=entry(bothRest?'partial':'missing',
    h.name+' '+(rest[0]===null?'?':rest[0]!.toFixed(1))+' h; '+
    a.name+' '+(rest[1]===null?'?':rest[1]!.toFixed(1))+
    ' h; faltan itinerarios, 3-en-4 y fatiga real')
  results.U06=entry(bothRest?'partial':'missing',
    'Descanso contrastado; árbitros, viajes, sede y contexto por investigar')
  results.B10=entry(d.matchups.length>0||h2h.games>0?'partial':'missing',
    d.matchups.length+' emparejamientos candidatos; H2H '+
    h2h.games+' juegos ('+h2h.homeWins+' local/'+h2h.awayWins+
    ' visitante). Falta desempeño efectivo vs defensor')
  results.B11=entry('missing','No existe salida de modelos ML, spread y total calibrados '+ 
    'con escenarios de titulares para esta investigación')
  results.U08=entry('missing','Sin predicción por mercado calibrada ni backtest fuera de muestra')
  results.B12=entry(d.markets.length||d.news.length||d.editorial.length?
    'partial':'missing',d.markets.length+' mercados observados, '+
    d.news.length+' noticias, '+d.editorial.length+
    ' artículos/editoriales. Faltan apertura, movimientos y auditoría completa')
  results.U09=entry(d.markets.length?'partial':'missing',
    d.markets.length+' precios de mercado; vigencia y casa de apuesta por cotejar')
  results.U10=entry(d.news.length||d.editorial.length?'partial':'missing',
    d.news.length+' noticias y '+d.editorial.length+
    ' editoriales; no equivale a auditoría adversarial terminada')
  return results
}
