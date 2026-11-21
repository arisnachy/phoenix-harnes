import { useEffect, useState, type ReactNode } from 'react'
import { PhoenixUiIcon } from '@phoenix-ai/dsh-client-ui-primitives'
import { applyVisualCommand, readVisualBoard, VISUAL_KINDS,
  type VisualBoard, type VisualKind, type VisualWidget, type VisualCommand } from './AdaptiveVisualKit.ts'
import css from './AdaptiveVisualStudio.module.css'

const catalog = Object.entries(VISUAL_KINDS) as Array<[VisualKind, typeof VISUAL_KINDS[VisualKind]]>
function WidgetContent({widget}:{widget:VisualWidget}):ReactNode {
  switch(widget.kind){
    case 'metric': return <div className={css.metric}><strong>—</strong><span>Conectar indicador</span></div>
    case 'card': return <div className={css.description}>Resumen con título, información y acciones configurables.<div className={css.skeleton}/><div className={css.skeletonShort}/></div>
    case 'avatar': return <div className={css.profile}><span className={css.avatar}>UI</span><span><strong>Perfil sin conectar</strong><small>Avatar e información del usuario</small></span></div>
    case 'table': return <div className={css.tableScroll}><table><thead><tr><th>Columna</th><th>Estado</th><th>Detalle</th></tr></thead><tbody><tr><td>Sin registros</td><td>—</td><td>Vincular origen autorizado</td></tr></tbody></table></div>
    case 'chart': return <div className={css.chart} role="img" aria-label="Estructura de gráfica sin datos reales"><div style={{height:'38%'}}/><div style={{height:'65%'}}/><div style={{height:'48%'}}/><div style={{height:'80%'}}/><div style={{height:'58%'}}/></div>
    case 'calendar': return <div className={css.calendar}>{['L','M','M','J','V','S','D'].map((day,i)=><span key={i}>{day}</span>)}{Array.from({length:14},(_,i)=><span key={i+7} className={css.day}>{i+1}</span>)}</div>
    case 'timeline': return <ol className={css.timeline}><li>Diseño</li><li>Conexión pendiente</li><li>Verificación</li></ol>
    case 'alert': return <div className={css.alert}><strong>Estado informativo</strong><span>Personaliza el mensaje y su origen de datos.</span></div>
  }
}
export function AdaptiveVisualStudio({appId,sectionId}:{appId:string;sectionId:string}) {
  const [board,setBoard] = useState<VisualBoard>(()=>readVisualBoard(appId,sectionId))
  const [editing,setEditing]=useState(false)
  const [kind,setKind]=useState<VisualKind>('card')
  const [title,setTitle]=useState('Resumen')
  const [error,setError]=useState('')
  const [drafts,setDrafts]=useState<Record<string,string>>({})
  useEffect(()=>{
    setBoard(readVisualBoard(appId,sectionId));setDrafts({});setError('')
    const refresh=(event:Event):void=>{
      const detail=(event as CustomEvent<{appId?:string;sectionId?:string}>).detail
      if(detail?.appId===appId&&detail.sectionId===sectionId){
        setBoard(readVisualBoard(appId,sectionId));setDrafts({});setError('')
      }
    }
    window.addEventListener('phoenix:adaptive-visual-refreshed',refresh)
    return ()=>window.removeEventListener('phoenix:adaptive-visual-refreshed',refresh)
  },[appId,sectionId])
  const change=(patch:Omit<VisualCommand,'appId'|'sectionId'|'expectedRevision'>):void=>{
    try{
      const next=applyVisualCommand({...patch,appId,sectionId,expectedRevision:board.revision} as VisualCommand)
      setBoard(next);setError('')
    }catch{setError('No fue posible modificar la vista. El diseño anterior sigue disponible.')}
  }
  return <section className={css.studio} aria-label="Estudio visual de la aplicación" data-visual-revision={board.revision}>
    <header className={css.heading}>
      <div><span className={css.eyebrow}>PHOENIX · INTELLIGENT UI KIT</span><h3>Diseño de pantalla</h3>
        <p>Componentes editables. Los datos ilustrativos no representan información real ni ejecutan conectores.</p></div>
      <button type="button" className={css.switch} aria-pressed={editing} onClick={()=>setEditing(v=>!v)}>
        {editing?'Finalizar edición':'Personalizar diseño'}
      </button>
    </header>
    {editing&&<div className={css.catalog} aria-label="Catálogo visual">
      <label>Componente<select aria-label="Tipo de componente visual" value={kind} onChange={event=>{
        const selected=event.currentTarget.value as VisualKind
        setKind(selected);setTitle(VISUAL_KINDS[selected].label)
      }}>{catalog.map(([key,value])=><option key={key} value={key}>{value.label}</option>)}</select></label>
      <label>Título<input aria-label="Título de componente" maxLength={60} value={title}
        onChange={event=>setTitle(event.currentTarget.value)}/></label>
      <button type="button" className={css.add} disabled={!title.trim()||board.widgets.length>=18}
        onClick={()=>change({operation:'add-widget',widgetKind:kind,label:title.trim(),span:'half'})}>Añadir a pantalla</button>
      <span className={css.hint}>{board.widgets.length}/18 componentes · {catalog.length} tipos</span>
    </div>}
    {board.widgets.length===0?<div className={css.empty}>
      <div className={css.emptyOrb} aria-hidden="true"><span/></div>
      <strong>Tu pantalla está lista para diseñarse</strong>
      <p>Añade indicadores, tarjetas, avatares, tablas, gráficas, calendarios o alertas sin programar desde cero.</p>
      {!editing&&<button type="button" className={css.add} onClick={()=>setEditing(true)}>Explorar componentes</button>}
    </div>:<div className={css.grid}>
      {board.widgets.map((widget,index)=><article key={widget.id}
        className={css.widget} data-visual-kind={widget.kind} data-span={widget.span}>
        <div className={css.widgetHeading}>
          <div className={css.widgetIdentity}><span className={css.icon} aria-hidden="true"><PhoenixUiIcon name={VISUAL_KINDS[widget.kind].icon} size={17}/></span>
            <div><strong>{widget.title}</strong><small>{VISUAL_KINDS[widget.kind].description}</small></div></div>
          {editing&&<div className={css.tools}>
            <button type="button" aria-label={'Mover arriba '+widget.title} disabled={index===0}
              onClick={()=>change({operation:'move-widget',widgetId:widget.id,direction:'up'})}><PhoenixUiIcon name="arrow-up" size={14}/></button>
            <button type="button" aria-label={'Mover abajo '+widget.title} disabled={index===board.widgets.length-1}
              onClick={()=>change({operation:'move-widget',widgetId:widget.id,direction:'down'})}><PhoenixUiIcon name="arrow-down" size={14}/></button>
            <button type="button" aria-label={'Cambiar ancho '+widget.title} title="Alternar ancho"
              onClick={()=>change({operation:'set-widget-span',widgetId:widget.id,span:widget.span==='half'?'full':'half'})}><PhoenixUiIcon name="expand" size={14}/></button>
            <button type="button" aria-label={'Quitar '+widget.title}
              onClick={()=>change({operation:'remove-widget',widgetId:widget.id})}><PhoenixUiIcon name="trash-2" size={14}/></button>
          </div>}
        </div>
        <WidgetContent widget={widget}/>
        {editing&&<label className={css.rename}>Renombrar
          <input aria-label={'Nuevo título '+widget.title} maxLength={60}
            value={drafts[widget.id]??widget.title} onChange={event=>setDrafts(d=>({...d,[widget.id]:event.currentTarget.value}))}
            onBlur={()=>{const name=(drafts[widget.id]??widget.title).trim()
              if(name&&name!==widget.title)change({operation:'rename-widget',widgetId:widget.id,label:name})
              setDrafts(d=>{const next={...d};delete next[widget.id];return next})}}
            onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}}/></label>}
        <footer className={css.widgetFooter}>Vista declarativa · sin datos conectados</footer>
      </article>)}
    </div>}
    {error&&<p className={css.error} role="alert">{error}</p>}
    <p className={css.footnote}>El diseño guarda únicamente tipos, títulos y disposición en el navegador. No almacena expedientes, entradas de formularios, contraseñas ni claves API.</p>
  </section>
}
