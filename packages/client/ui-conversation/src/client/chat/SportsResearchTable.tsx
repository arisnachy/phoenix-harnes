/** Inline, sequential sports research evidence, not a ticket or an opaque card. */
import type {ReactNode} from 'react'
import css from './SportsResearchTable.module.css'

export type SportsResearchStage='teams'|'rosters'|'availability'|'context'|'news'|'odds'
export type SportsResearchTableRow={
  label:string;home:string;away:string;note?:string;url?:string;
  homeImage?:string;awayImage?:string;
  state?:'verified'|'reported'|'pending'|'indexed'
}
export type SportsResearchTableProps={
  sport:string;league:string;eventId:string;stage:SportsResearchStage;
  title:string;checkedAt:string;source:string;note:string;
  home:{name:string;logo?:string};away:{name:string;logo?:string};
  rows:SportsResearchTableRow[];missing:string[]
}
const labels:Record<SportsResearchStage,string>={
  teams:'Equipos y panorama',
  rosters:'Jugadores, roles y estadísticas',
  availability:'Lesiones, titulares y rotaciones',
  context:'Forma, sede, clima y enfrentamientos',
  news:'Noticias y opiniones contrastables',
  odds:'Cuotas observadas en ESPN',
}
const steps:SportsResearchStage[]=[
  'teams','rosters','availability','context','news','odds',
]
/** Source-only comparison in the message flow. It does not assign scores
 * or use images/links other than URLs validated in GenerativeUi. */
export function SportsResearchTable({value}:{value:SportsResearchTableProps}):ReactNode{
  const current=steps.indexOf(value.stage)+1
  return <section className={css.root} data-generative-ui="sports_research_table"
    aria-label={'Investigación '+value.stage+' de '+value.away.name+' contra '+value.home.name}>
    <header className={css.top}>
      <div className={css.step}><span>INVESTIGACIÓN · {value.sport.toUpperCase()}</span>
        <small>Etapa {current} de {steps.length}</small></div>
      <h3>{labels[value.stage]} · {value.title}</h3>
    </header>
    <div className={css.scroll}>
      <table className={css.table}>
        <thead><tr><th scope="col">Dato investigado</th>
          <th scope="col"><span className={css.club}>
            {value.home.logo&&<img src={value.home.logo} alt="" loading="lazy"/>}
            {value.home.name}</span></th>
          <th scope="col"><span className={css.club}>
            {value.away.logo&&<img src={value.away.logo} alt="" loading="lazy"/>}
            {value.away.name}</span></th>
        </tr></thead>
        <tbody>{value.rows.map((r,i)=><tr key={i}>
          <th scope="row"><span className={css.fact}>{r.label}</span>
            {r.state&&<small className={css.sourceState}>{r.state==='verified'?'Verificado':
              r.state==='reported'?'Reportado':r.state==='indexed'?'Índice de prensa':
                'Pendiente'}</small>}
            {r.url&&<a href={r.url} rel="noopener noreferrer" target="_blank">
              Ver fuente</a>}
          </th>
          <td>{r.homeImage&&<img className={css.avatar} src={r.homeImage}
            alt="" loading="lazy"/>}{r.home}</td>
          <td>{r.awayImage&&<img className={css.avatar} src={r.awayImage}
            alt="" loading="lazy"/>}{r.away}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {value.missing.length>0&&<p className={css.missing}><strong>Por investigar:</strong>{' '}
      {value.missing.slice(0,8).join(' · ')}</p>}
    <footer className={css.footer}>Fuente: {value.source} · {value.checkedAt}.
      {' '}{value.note}</footer>
  </section>
}
