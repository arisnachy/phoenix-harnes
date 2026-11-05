import { useMemo, useState } from 'react'
import css from './ForecastFanChart.module.css'

export interface ForecastFanPoint {
  label: string
  observed?: number
  forecast?: number
  lower?: number
  upper?: number
}
export interface ForecastFanChartProps {
  title: string
  unit: string
  points: ForecastFanPoint[]
  axis?: 'date' | 'category'
}
const WIDTH = 800, HEIGHT = 300, LEFT = 64, RIGHT = 24, TOP = 22, BOTTOM = 50
const show = (number: number): string => new Intl.NumberFormat('es-DO',{maximumFractionDigits:2}).format(number)
const shortDate = (s: string): string => {
  const d = new Date(s)
  return Number.isNaN(d.valueOf()) ? s.slice(0,12) : d.toLocaleDateString('es-DO',{day:'2-digit',month:'short',timeZone:'UTC'})
}
/** Chart render is pure SVG; no external scripts, data fetching, or dependency on LLM-generated HTML. */
export function ForecastFanChart({ title, unit, points, axis='date' }: ForecastFanChartProps) {
  const [table, setTable] = useState(false)
  const axisLabel = (label:string) => axis==='category'?label.slice(0,22):shortDate(label)
  const [band, setBand] = useState(true)
  const chart = useMemo(() => {
    const all = points.flatMap(p=>[p.observed,p.forecast,p.lower,p.upper]).filter((n):n is number=>typeof n==='number')
    if (!all.length) return null
    const min = Math.min(...all), max = Math.max(...all)
    const gap = Math.max(1e-6,(max-min)*.12)
    const lo = min-gap, hi=max+gap
    const x = (i:number) => LEFT+i*(WIDTH-LEFT-RIGHT)/Math.max(1,points.length-1)
    const y = (v:number) => TOP+(hi-v)/(hi-lo)*(HEIGHT-TOP-BOTTOM)
    const line = (key:'observed'|'forecast') => points.map((p,i)=>{
      const value=p[key]
      return value===undefined?null:{x:x(i),y:y(value)}
    }).reduce((state:{parts:string[];connected:boolean},p)=>{
      if(!p)return {parts:state.parts,connected:false}
      return {parts:[...state.parts,(state.connected?'L':'M')+p.x.toFixed(2)+' '+p.y.toFixed(2)],connected:true}
    },{parts:[],connected:false}).parts.join(' ')
    const uncertainty = points.map((p,i)=>p.lower===undefined||p.upper===undefined
      ?null:{x:x(i),lower:y(p.lower),upper:y(p.upper)}).filter((v):v is {x:number;lower:number;upper:number}=>v!==null)
    const polygon = uncertainty.length<2?'':[
      ...uncertainty.map(v=>v.x.toFixed(2)+','+v.upper.toFixed(2)),
      ...[...uncertainty].reverse().map(v=>v.x.toFixed(2)+','+v.lower.toFixed(2)),
    ].join(' ')
    const firstFuture=points.findIndex((p,i)=>i>0&&p.forecast!==undefined&&p.observed===undefined)
    return {min:lo,max:hi,x,y,observed:line('observed'),forecast:line('forecast'),polygon,
      firstFuture,hasBand:uncertainty.length>0}
  },[points])
  if (!chart) return <p role="status">No hay observaciones numéricas para graficar.</p>
  return <figure className={css.panel}>
    <div className={css.heading}>
      <div>
        <strong>{title}</strong>
        <span>{axis==='category'?'Frecuencia pronosticada vs observada':'Datos observados · pronóstico · intervalo empírico'}</span>
      </div>
      <div className={css.controls} aria-label="Opciones de visualización">
        {chart.hasBand && <button type="button" aria-pressed={band} onClick={()=>setBand(v=>!v)}>
          {band?'Ocultar banda':'Mostrar banda'}
        </button>}
        <button type="button" aria-pressed={table} onClick={()=>setTable(v=>!v)}>
          {table?'Ver gráfica':'Ver tabla'}
        </button>
      </div>
    </div>
    {table ? <div className={css.tableWrap}>
      <table>
        <caption>Observaciones, estimaciones y límites de incertidumbre en {unit}</caption>
        <thead><tr><th scope="col">Fecha</th><th scope="col">Observado</th><th scope="col">Proyección</th><th scope="col">Inferior</th><th scope="col">Superior</th></tr></thead>
        <tbody>{points.map((p,i)=><tr key={i}>
          <th scope="row">{axisLabel(p.label)}</th>
          {[p.observed,p.forecast,p.lower,p.upper].map((v,j)=><td key={j}>{v===undefined?'—':show(v)}</td>)}
        </tr>)}</tbody>
      </table>
    </div> : <>
      <svg className={css.figure} viewBox={'0 0 '+WIDTH+' '+HEIGHT} role="img" aria-label={title+'. {axis==='category'?'Relación de calibración': 'Serie observada, proyección e intervalo empírico.'}'}>
        {Array.from({length:5},(_,i)=>{
          const v=chart.max-(chart.max-chart.min)*i/4, y=chart.y(v)
          return <g key={i}><line x1={LEFT} y1={y} x2={WIDTH-RIGHT} y2={y} className={css.gridLine}/>
            <text x={LEFT-12} y={y+4} textAnchor="end" className={css.axis}>{show(v)}</text></g>
        })}
        {chart.firstFuture>=0&&<line x1={chart.x(chart.firstFuture)-6} x2={chart.x(chart.firstFuture)-6}
          y1={TOP} y2={HEIGHT-BOTTOM} className={css.transition}/>}
        {band&&chart.polygon&&<polygon points={chart.polygon} className={css.confidence}/>}
        {chart.observed&&<path d={chart.observed} className={css.observed}/>}
        {chart.forecast&&<path d={chart.forecast} className={css.forecast}/>}
        {points.map((p,i)=>(i===0||i===points.length-1||i%Math.max(1,Math.floor(points.length/6))===0)
          ?<text key={i} x={chart.x(i)} y={HEIGHT-20} textAnchor="middle" className={css.axis}>{shortDate(p.label)}</text>:null)}
        {points.map((p,i)=>p.forecast!==undefined&&i===points.length-1
          ?<circle key={i} cx={chart.x(i)} cy={chart.y(p.forecast)} r="5" className={css.endpoint}>
            <title>{shortDate(p.label)}: {show(p.forecast)} {unit}</title>
          </circle>:null)}
      </svg>
      <div className={css.legend}>
        <span><i className={css.observedKey}/> Observado</span>
        <span><i className={css.forecastKey}/> Proyección</span>
        {chart.hasBand&&band&&<span><i className={css.bandKey}/> Incertidumbre nominal 80 %</span>}
      </div>
    </>}
    <figcaption>{axis==='category'?'Las frecuencias son resultados históricos reportados, no verificación independiente.':'La banda representa errores históricos estimados; no garantiza cobertura futura.'} Unidad: {unit}.</figcaption>
  </figure>
}
