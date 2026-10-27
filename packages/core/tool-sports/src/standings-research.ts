/** Evidence-limited standings comparison, never a model win probability. */
export type StandingsTeam = {
  team?:{displayName?:string;name?:string}
  records?:Array<{summary?:string;name?:string;type?:string}>
}
export type StandingsResearch = {
  favorite:string
  method:string
  source:string
  evidence:string[]
}
export type StandingsSignal = {pick:'home'|'away'|null;edge:number;research:StandingsResearch}
type ParsedRecord={wins:number;losses:number;draws:number;games:number;summary:string}
const parseRecord=(side?:StandingsTeam):ParsedRecord|null=>{
  const records=side?.records??[]
  const preferred=[...records].sort((a,b)=>
    Number(b.type==='total'||b.name==='overall')-Number(a.type==='total'||a.name==='overall'))
  for(const record of preferred){
    const summary=record.summary??''
    const m=summary.match(/^(\d{1,3})-(\d{1,3})(?:-(\d{1,3}))?$/u)
    if(!m)continue
    // ESPN soccer records may be W-D-L; two-part records are W-L.
    const wins=Number(m[1]),draws=m[3]===undefined?0:Number(m[2])
    const losses=Number(m[3]??m[2])
    const games=wins+draws+losses
    if(games>0&&games<=200)return {wins,draws,losses,games,summary}
  }
  return null
}
const name=(side?:StandingsTeam):string=>
  (side?.team?.displayName??side?.team?.name??'Equipo sin identificar').slice(0,75)
/**
 * Select only a descriptive standings trend.
 * A small sample is explicitly labelled provisional; injuries, opponent strength,
 * efficiency and market prices are not guessed from scoreboard fields.
 */
export function compareStandings(home?:StandingsTeam,away?:StandingsTeam):StandingsSignal {
  const h=parseRecord(home),a=parseRecord(away)
  const homeName=name(home),awayName=name(away)
  const evidence=[
    homeName+': '+(h?.summary??'récord no disponible')+' (local)',
    awayName+': '+(a?.summary??'récord no disponible')+' (visitante)',
  ]
  const source='ESPN Site API · récords de la cartelera'
  const method='Comparación descriptiva de récords con suavizado. No incluye lesiones, alineaciones, calidad del rival, eficiencia ni cuotas; no es una probabilidad de victoria.'
  if(!h||!a){
    return {pick:null,edge:0,research:{
      favorite:'Sin favorito fundamentado',method,source,
      evidence:[...evidence,'Faltan récords comparables para ambos equipos.'],
    }}
  }
  const hp=(h.wins+h.draws*0.5+1)/(h.games+2)
  const ap=(a.wins+a.draws*0.5+1)/(a.games+2)
  const difference=hp-ap
  const edge=Math.abs(difference)
  if(edge<0.055){
    return {pick:null,edge,research:{
      favorite:'Sin ventaja clara por récord',method,source,
      evidence:[...evidence,'Diferencia descriptiva pequeña; investigar métricas contextuales.'],
    }}
  }
  const homeFavorite=difference>0
  const chosen=homeFavorite?homeName:awayName
  const provisional=Math.min(h.games,a.games)<10
  return {pick:homeFavorite?'home':'away',edge,research:{
    favorite:(provisional?'Tendencia provisional: ':'Tendencia por récord: ')+chosen,
    method,source,
    evidence:[...evidence,
      provisional?'Muestra pequeña: no permite señalar un favorito sólido.':'Verificar bajas, ritmo y fuerza del calendario antes de apostar.'],
  }}
}
