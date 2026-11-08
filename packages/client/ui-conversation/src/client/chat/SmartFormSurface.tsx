import { useMemo, useState, type ReactNode } from 'react'
import { PhoenixUiIcon, choosePhoenixUiIcon } from '@phoenix-ai/dsh-client-ui-primitives'
import {
  calculateSmartForm, fieldVisible, initialSmartValues, parseSmartForm,
  type FormValue, type SmartField, type SmartFormSpec,
} from './SmartFormEngine.ts'
import {
  exportSmartForms, importSmartForms, libraryIndex, removeSmartForm, removeSmartRun,
  saveSmartForm, saveSmartRun, savedForms, savedRuns, starterForms,
  type SavedSmartForm, type SavedSmartRun,
} from './SmartFormLibrary.ts'
import type { CanvasAction } from './GenerativeCanvas.tsx'
import { assessmentCatalog } from './AssessmentCatalog.ts'
import { ScaleForm, parseScaleForm, type ScaleFormSpec } from './ScaleForm.tsx'
import { generateAssessmentPdf } from './AssessmentReportPdf.ts'
import { smartAssessmentReport } from './AssessmentReportModel.ts'
import css from './SmartFormSurface.module.css'

type Panel = 'form' | 'library' | 'history'
interface Props { readonly initial?: SmartFormSpec | undefined; readonly onAction?: CanvasAction | undefined; readonly title?: string | undefined }
function download(filename:string, contents:string):void {
  const url=URL.createObjectURL(new Blob([contents],{type:'application/json'}))
  const a=document.createElement('a')
  a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url)
}
function Field({field,value,onChange}:{
  readonly field:SmartField
  readonly value:FormValue|undefined
  readonly onChange:(value:FormValue|undefined)=>void
}):ReactNode {
  const id='sf-'+field.id
  const updateNumber=(raw:string)=>onChange(raw===''?undefined:Number(raw))
  const text=typeof value==='string'?value:''
  return <div className={css.field} data-smart-field={field.id}>
    <label htmlFor={id} className={css.fieldLabel}>{field.label}
      {field.unit && <span className={css.unit}>{field.unit}</span>}
      {field.required!==false && <span className={css.required}> *</span>}</label>
    {field.type==='number' && <input id={id} type="number" value={typeof value==='number'?value:''}
      min={field.min} max={field.max} step={field.step??'any'} placeholder={field.placeholder}
      onChange={e=>updateNumber(e.currentTarget.value)}/>}
    {field.type==='range' && <div className={css.rangeRow}>
      <input id={id} type="range" value={typeof value==='number'?value:field.min??0}
        min={field.min} max={field.max} step={field.step??1}
        onChange={e=>updateNumber(e.currentTarget.value)}/>
      <output htmlFor={id}>{String(value??field.min??0)}</output></div>}
    {(field.type==='text'||field.type==='date'||field.type==='time') &&
      <input id={id} type={field.type} value={text} placeholder={field.placeholder}
        onChange={e=>onChange(e.currentTarget.value||undefined)}/>}
    {field.type==='textarea' && <textarea id={id} rows={3} maxLength={3000} value={text}
      placeholder={field.placeholder} onChange={e=>onChange(e.currentTarget.value||undefined)}/>}
    {field.type==='select' && <select id={id} value={value===undefined?'':String(value)}
      onChange={e=>{
        const raw=e.currentTarget.value
        onChange(raw===''?undefined:field.options?.find(o=>String(o.value)===raw)?.value??raw)
      }}>
      <option value="">Seleccionar…</option>
      {field.options?.map(o=><option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>}
    {field.type==='radio' && <fieldset className={css.radioGroup}>
      <legend className={css.visuallyHidden}>{field.label}</legend>
      {field.options?.map(o=><label key={String(o.value)} className={css.radioChoice}>
        <input type="radio" name={field.id} value={String(o.value)}
          checked={value===o.value} onChange={()=>onChange(o.value)}/>{o.label}
      </label>)}
    </fieldset>}
    {field.type==='checkbox' && <label className={css.checkRow}>
      <input id={id} type="checkbox" checked={value===true}
        onChange={e=>onChange(e.currentTarget.checked)}/><span>Sí</span>
    </label>}
    {field.description && <span className={css.hint}>{field.description}</span>}
  </div>
}
const defaultFormPrompt='Construye una interfaz nativa de PHOENIX en un bloque generative-ui JSON con component smart_form y version 1. Incluye props.id, props.title, props.kind, props.folder, props.fields y props.outputs. Campos: {id,label,type,required,min,max,step,unit,options:[{label,value}]}; tipos number,range,text,textarea,date,time,select,radio,checkbox. Salidas: {id,label,expression,precision,unit,bands:[{max,label}]}. Expresiones JSON sin JavaScript: {field:"id"}, {constant:2}, {today:true}, o {op:"add|sub|mul|div|pow|sqrt|ln|log10|sin|cos|tan|floor|round|days_between|add_days|if|eq|gt|lt",args:[...]}. Usa fórmulas documentadas, unidades explícitas y no inventes validez clínica.'

const assessmentPrompt='Crea una evaluación universal completa y funcional en PHOENIX, usando generative-ui JSON con component scale_form y version 1. Incluye props.title, description, source, version, population, administration:[{id,title,instruction,phase:"prepare|administer|score"}], items:[{id,question,help,options:[{label,score}]}], scoring:{min,max,direction,note}, bands y, si hay dimensiones, domains:[{id,label,items:[ids]}]. Comprueba puntuaciones, rangos, dimensiones y procedencia antes de entregar. Si solicito una escala clínica con nombre propio, consulta su protocolo y versión lingüística autorizada; no inventes estímulos protegidos, validación ni puntos de corte. Si el procedimiento no se puede verificar, indica que es solo un registro no validado y qué falta. Para fórmulas no aditivas usa smart_form con expressions dependientes de campos. No entregues una tarjeta decorativa ni dos campos de registro como si fueran una prueba completa.'

/** Model-facing component is declarative: all persistence and execution happen only in the client. */
export function SmartFormWorkspace({initial,onAction,title}:Props):ReactNode {
  const [active,setActive]=useState<SmartFormSpec|undefined>(initial)
  const [panel,setPanel]=useState<Panel>(initial?'form':'library')
  const [values,setValues]=useState<Record<string,FormValue>>(()=>initial?initialSmartValues(initial):{})
  const [library,setLibrary]=useState<SavedSmartForm[]>(savedForms)
  const [runs,setRuns]=useState<SavedSmartRun[]>(savedRuns)
  const [filter,setFilter]=useState('')
  const [folder,setFolder]=useState(initial?.props.folder??'General')
  const [includeAnswers,setIncludeAnswers]=useState(false)
  const [message,setMessage]=useState('')
  const [confirmDelete,setConfirmDelete]=useState<string|null>(null)
  const [assessmentId,setAssessmentId]=useState<string|null>(null)
  const [assessments,setAssessments]=useState<ScaleFormSpec[]>([])
  const [usageAuthorized,setUsageAuthorized]=useState(false)
  const [reportIdentity,setReportIdentity]=useState({participant:'',professional:'',context:'',observations:'',recommendations:''})
  const current=useMemo(()=>active?calculateSmartForm(active,values):null,[active,values])
  const allForms=useMemo(()=>{
    const map=new Map<string,{spec:SmartFormSpec;revision:number}>()
    for(const spec of starterForms)map.set(spec.props.id,{spec,revision:0})
    for(const stored of library)map.set(stored.spec.props.id,{spec:stored.spec,revision:stored.revision})
    return [...map.values()]
  },[library])
  const filtered=useMemo(()=>{
    const normalized=filter.trim().toLocaleLowerCase('es')
    return allForms.filter(({spec})=>
      [spec.props.title,spec.props.id,spec.props.folder??'General',...(spec.props.tags??[])]
        .join(' ').toLocaleLowerCase('es').includes(normalized))
      .sort((a,b)=>(a.spec.props.folder??'General').localeCompare(b.spec.props.folder??'General')||
        a.spec.props.title.localeCompare(b.spec.props.title))
  },[allForms,filter])
  const open=(spec:SmartFormSpec):void=>{
    setActive(spec);setValues(initialSmartValues(spec));setFolder(spec.props.folder??'General')
    setIncludeAnswers(false);setReportIdentity({participant:'',professional:'',context:'',observations:'',recommendations:''});setPanel('form');setMessage('')
  }
  const setValue=(id:string,v:FormValue|undefined):void=>{
    setValues(old=>{
      const next={...old}
      if(v===undefined)delete next[id]
      else next[id]=v
      return next
    });setMessage('')
  }
  const saveDefinition=():void=>{
    if(!active)return
    const parsed=parseSmartForm({...active,props:{...active.props,folder:folder.trim()}})
    if(!parsed){setMessage('Carpeta no válida. Usa letras, números, /, _ o guiones.');return}
    const result=saveSmartForm(parsed)
    setLibrary(savedForms())
    if(result.ok){setActive(parsed);setMessage('Plantilla guardada · revisión '+result.revision)}
    else setMessage('No fue posible guardar. Comprueba el almacenamiento de este navegador.')
  }
  const saveResult=():void=>{
    if(!active||!current?.ready||!includeAnswers)return
    if(saveSmartRun(active,values,current)){
      setRuns(savedRuns());setIncludeAnswers(false);setMessage('Resultado guardado localmente en Historial.')
    }else setMessage('No fue posible guardar el resultado.')
  }
  const onImport=async(file:File|undefined):Promise<void>=>{
    if(!file)return
    if(file.size>2_000_000){setMessage('El archivo supera 2 MB.');return}
    try{
      const result=importSmartForms(await file.text())
      setLibrary(savedForms())
      setMessage(result.ok?'Importadas '+result.count+' plantillas.':'Archivo no válido o biblioteca llena.')
    }catch{setMessage('No se pudo leer el archivo.')}
  }
  const importAssessment=async(file:File|undefined):Promise<void>=>{
    if(!file)return
    if(!usageAuthorized){setMessage('Confirma primero que puedes utilizar esta versión del instrumento.');return}
    if(file.size>400_000){setMessage('La definición supera 400 KB.');return}
    try{
      const json=JSON.parse(await file.text()) as unknown
      const spec=parseScaleForm(json)
      if(!spec || !spec.props.source || !spec.props.version
        || !spec.props.administration?.length){
        setMessage('Instrumento inválido: exige preguntas, puntuaciones, fuente, versión y administración.')
        return
      }
      setAssessments(list=>[...list.filter(x=>x.props.title!==spec.props.title),spec])
      setAssessmentId('import:'+spec.props.title)
      setMessage('Instrumento importado para esta sesión. Revisa su validez antes de administrarlo.')
    }catch{setMessage('No se pudo leer la definición JSON autorizada.')}
  }
  const exportPdf=():void=>{
    if(!active || !current)return
    const report=smartAssessmentReport(active,values,current,reportIdentity)
    if(!report){setMessage('Completa las respuestas válidas antes de exportar el PDF.');return}
    try{
      const pdf=generateAssessmentPdf(report)
      const url=URL.createObjectURL(pdf)
      const a=document.createElement('a')
      a.href=url;a.download='PHOENIX-formulario-'+active.props.id+'.pdf';a.click()
      URL.revokeObjectURL(url)
      setMessage('Informe PDF generado localmente, sin guardar los datos.')
    }catch{setMessage('No fue posible generar el informe PDF.')}
  }
  const shareIndex=()=>onAction?.(
    'Este es el índice de formularios guardados en PHOENIX. Pídeme abrir un formulario para enviarte su definición completa: '+JSON.stringify(libraryIndex()),'draft')
  return <section className={css.surface} data-generative-ui={initial?'smart_form':'smart_form_library'}>
    <header className={css.heading}>
      <span className={css.emblem}><PhoenixUiIcon name={choosePhoenixUiIcon(active?.props.title ?? title ?? "calculadora")} size={19} label={active?.props.title ?? title ?? "calculadora"}/></span>
      <div><h3>{active&&panel==='form'?active.props.title:title??'Biblioteca inteligente de PHOENIX'}</h3>
        <p>{panel==='form'?active?.props.description:'Calculadoras, pruebas, escalas y formularios reutilizables'}</p>
      </div>
    </header>
    <nav className={css.tabs} aria-label="Herramientas de formularios">
      {active&&<button type="button" aria-current={panel==='form'?'page':undefined} onClick={()=>setPanel('form')}>Formulario</button>}
      <button type="button" aria-current={panel==='library'?'page':undefined} onClick={()=>setPanel('library')}>Biblioteca ({allForms.length})</button>
      <button type="button" aria-current={panel==='history'?'page':undefined} onClick={()=>setPanel('history')}>Resultados ({runs.length})</button>
    </nav>
    {panel==='form'&&active&&<>
      <div className={css.metadata}><span>{active.props.kind}</span><span>{active.props.folder??'General'}</span>
        <span>{active.props.fields.length} campos</span></div>
      <div className={css.fields}>{active.props.fields.filter(f=>fieldVisible(f,values)).map(f=>
        <Field key={f.id} field={f} value={values[f.id]} onChange={v=>setValue(f.id,v)}/>)}</div>
      {active.props.outputs&&active.props.outputs.length>0&&<section className={css.outputs} aria-live="polite">
        <h4>Resultados calculados</h4>
        {current?.missing.length?<p className={css.hint}>Completa los campos obligatorios ({current.missing.length} pendientes).</p>:null}
        <div className={css.outputGrid}>{current?.outputs.map(o=><div key={o.id} className={css.output}>
          <span>{o.label}</span><strong>{o.text} {o.unit??''}</strong>
          {o.band&&<small>{o.band}</small>}
          {o.error&&<small className={css.error}>{o.error}</small>}
        </div>)}</div>
      </section>}
      <div className={css.formToolbar}>
        {library.find(saved=>saved.spec.props.id===active.props.id)?.history?.length ?
          <label className={css.folderLabel}>Versiones anteriores
            <select value="" onChange={e=>{
              const saved=library.find(item=>item.spec.props.id===active.props.id)
              const previous=saved?.history?.find(v=>String(v.revision)===e.currentTarget.value)
              if(previous){open(previous.spec);setMessage('Versión antigua abierta. Pulsa Guardar plantilla para restaurarla como nueva revisión.')}
            }}>
              <option value="">Elegir una versión…</option>
              {library.find(saved=>saved.spec.props.id===active.props.id)?.history?.map(v=>
                <option key={v.revision} value={String(v.revision)}>Revisión {v.revision}</option>)}
            </select>
          </label>:null}
        <label className={css.folderLabel}>Carpeta <input type="text" value={folder} maxLength={90}
          onChange={e=>setFolder(e.currentTarget.value)} placeholder="Salud/Calculadoras" /></label>
        <div className={css.actions}>
          <button type="button" onClick={saveDefinition}><PhoenixUiIcon name="save" size={14} tone="info"/> Guardar plantilla</button>
          <button type="button" onClick={()=>download(active.props.id+'.smart-form.json',JSON.stringify(active,null,2))}>Exportar JSON</button>
          <button type="button" onClick={()=>{setValues(initialSmartValues(active));setMessage('')}}>Reiniciar</button>
          {onAction&&<button type="button" onClick={()=>onAction(
            'Adapta este formulario de PHOENIX a mis necesidades, devuelve un smart_form completo y conserva el id para guardar una revisión: '+JSON.stringify(active),'draft')}>Modificar con Kira</button>}
        </div>
      </div>
      {current?.ready&&<>
        <div className={css.privacy}>
          <label><input type="checkbox" checked={includeAnswers} onChange={e=>setIncludeAnswers(e.currentTarget.checked)}/>
            Autorizo guardar las respuestas y resultados en este navegador (sin cifrado)</label>
          <p>No es historia clínica. Evita identificadores y datos sensibles en equipos compartidos.</p>
        </div>
        <details className={css.reportEditor}>
          <summary>Datos del informe profesional PDF <span>Identificación, contexto y análisis del evaluador</span></summary>
          <div className={css.reportEditorFields}>
            <label>Persona evaluada / código
              <input type="text" maxLength={120} value={reportIdentity.participant}
                onChange={e=>{const value=e.currentTarget.value;setReportIdentity(old=>({...old,participant:value}))}}/>
            </label>
            <label>Profesional responsable y matrícula
              <input type="text" maxLength={120} value={reportIdentity.professional}
                onChange={e=>{const value=e.currentTarget.value;setReportIdentity(old=>({...old,professional:value}))}}/>
            </label>
            <label>Motivo y contexto
              <textarea rows={2} maxLength={1500} value={reportIdentity.context}
                onChange={e=>{const value=e.currentTarget.value;setReportIdentity(old=>({...old,context:value}))}}/>
            </label>
            <label>Observaciones documentadas
              <textarea rows={2} maxLength={2500} value={reportIdentity.observations}
                onChange={e=>{const value=e.currentTarget.value;setReportIdentity(old=>({...old,observations:value}))}}/>
            </label>
            <label>Recomendaciones del profesional
              <textarea rows={2} maxLength={2500} value={reportIdentity.recommendations}
                onChange={e=>{const value=e.currentTarget.value;setReportIdentity(old=>({...old,recommendations:value}))}}/>
            </label>
          </div>
        </details>
        <div className={css.actions}>
          <button type="button" disabled={!includeAnswers} onClick={saveResult}>Guardar resultado</button>
          <button type="button" onClick={exportPdf}>Exportar formulario completo a PDF</button>
          {onAction&&<button type="button" onClick={()=>onAction(
            'Analiza los resultados de este formulario, diferenciando cálculo de diagnóstico. Verifica límites, fuentes y datos faltantes. Plantilla: '+JSON.stringify(active)+' Respuestas: '+JSON.stringify(values)+' Resultado: '+JSON.stringify(current),'draft')}>Analizar con Kira</button>}
        </div>
      </>}
      <p className={css.footnote}>Cálculo local mediante reglas declaradas. {active.props.source?
        'Fuente declarada: '+active.props.source:'Fuente no verificada.'}
        {['scale','test'].includes(active.props.kind)?' Verificar versión, licencia y validación clínica antes de tomar decisiones.':''}
      </p>
    </>}
    {panel==='library'&&<>
      <div className={css.searchRow}>
        <input type="search" aria-label="Buscar formularios" placeholder="Buscar por título, carpeta o etiqueta…"
          value={filter} onChange={e=>setFilter(e.currentTarget.value)}/>
        <button type="button" onClick={()=>download('phoenix-biblioteca-formularios.json',exportSmartForms())}>Exportar</button>
        <label className={css.fileImport}>Importar
          <input type="file" accept=".json,application/json"
            onChange={e=>{void onImport(e.currentTarget.files?.[0]);e.currentTarget.value=''}}/></label>
      </div>
      <section className={css.catalog} aria-label="Instrumentos profesionales verificados">
        <h4>Instrumentos reales · medicina, psicología y neuropsicología</h4>
        <div className={css.searchRow}>
          <label className={css.privacy}>
            <input type="checkbox" checked={usageAuthorized}
              onChange={e=>setUsageAuthorized(e.currentTarget.checked)}/>
            Confirmo que dispongo de autorización o derechos de uso del instrumento que importaré.
          </label>
          <label className={css.fileImport}>Importar instrumento autorizado (JSON)
            <input type="file" accept=".json,application/json"
              disabled={!usageAuthorized} aria-label="Importar instrumento autorizado"
              onChange={e=>{void importAssessment(e.currentTarget.files?.[0]);e.currentTarget.value=''}}/>
          </label>
        </div>
        <p>Los catálogos identifican preguntas disponibles, versiones y restricciones
          de uso. Solo se reproducen instrumentos autorizados.</p>
        {assessmentCatalog.filter(entry=>!filter.trim() ||
          (entry.title+' '+entry.discipline).toLocaleLowerCase('es')
            .includes(filter.toLocaleLowerCase('es'))).map(entry=>
          <article className={css.catalogItem} key={entry.id}>
            <div>
              <small>{entry.discipline} · {entry.language} · {entry.access==='reproducible'
                ?'Cuestionario reproducible':entry.access==='external-protocol'
                  ?'Registro con protocolo externo':'Requiere licencia'}</small>
              <h4>{entry.title}</h4><p>{entry.description}</p>
              <small>Versión: {entry.version}</small>
            </div>
            <div className={css.smallActions}>
              {entry.spec&&<button type="button" onClick={()=>setAssessmentId(old=>
                old===entry.id?null:entry.id)}>{assessmentId===entry.id?'Cerrar':'Abrir prueba real'}</button>}
              <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">
                {entry.spec?'Consultar fuente':'Consultar licencia'}</a>
            </div>
          </article>)}
        {assessmentCatalog.filter(entry=>entry.id===assessmentId&&entry.spec).map(entry=>
          <ScaleForm key={entry.id} spec={entry.spec!} onAction={onAction}
            verified={entry.access==='reproducible'} />)}
        {assessments.map((spec,index)=>assessmentId==='import:'+spec.props.title&&
          <ScaleForm key={index} spec={spec} onAction={onAction} verified={false}/>)}
        {assessments.map(spec=><button key={spec.props.title} type="button"
          onClick={()=>setAssessmentId('import:'+spec.props.title)}>
          Abrir importado: {spec.props.title}
        </button>)}
      </section>
      {filtered.length===0&&<p className={css.hint}>No hay formularios de cálculo con ese término.</p>}
      <div className={css.catalog}>{filtered.map(({spec,revision})=>
        <article className={css.catalogItem} key={spec.props.id}>
          <div><small>{spec.props.folder??'General'} · {spec.props.kind} · {revision?'rev '+revision:'ejemplo inicial'}</small>
            <h4>{spec.props.title}</h4>{spec.props.description&&<p>{spec.props.description}</p>}</div>
          <div className={css.smallActions}>
            <button type="button" onClick={()=>open(spec)}>Abrir</button>
            {onAction&&<button type="button" onClick={()=>onAction(
              'Mejora esta plantilla de PHOENIX; devuelve una revisión completa smart_form con el mismo id: '+JSON.stringify(spec),'draft')}>Mejorar con Kira</button>}
            {revision>0&&<button type="button" className={css.danger} onClick={()=>{
              if(confirmDelete!==spec.props.id){setConfirmDelete(spec.props.id);return}
              if(removeSmartForm(spec.props.id)){setLibrary(savedForms());setMessage('Plantilla quitada.')}
              else setMessage('No se pudo quitar.')
              setConfirmDelete(null)
            }}>Quitar{confirmDelete===spec.props.id?' (confirmar)':''}</button>}
          </div>
        </article>)}</div>
      <div className={css.actions}>
        {onAction&&<><button type="button" onClick={()=>onAction(defaultFormPrompt,'draft')}>Crear calculadora con Kira</button>
          <button type="button" onClick={()=>onAction(assessmentPrompt,'draft')}>Crear evaluación o escala</button>
          <button type="button" onClick={shareIndex}>Compartir índice con Kira</button></>}
      </div>
      <p className={css.footnote}>Las carpetas organizan los formularios. La biblioteca vive en este perfil de navegador;
        exporta JSON para conservarla o transferirla a otro equipo.</p>
    </>}
    {panel==='history'&&<div className={css.catalog}>
      {runs.length===0&&<p className={css.hint}>Aún no hay resultados guardados.</p>}
      {runs.map(run=><article key={run.id} className={css.catalogItem}>
        <div><small>{new Date(run.savedAt).toLocaleString('es-DO')} · revisión {run.revision}</small>
          <h4>{allForms.find(f=>f.spec.props.id===run.formId)?.spec.props.title??run.formId}</h4>
          <p>{run.outputs.length?run.outputs.map(o=>o.label+': '+o.text+(o.unit?' '+o.unit:'')).join(' · '):'Formulario completado sin salidas calculadas'}</p></div>
        <div className={css.smallActions}>
          {onAction&&<button type="button" onClick={()=>onAction(
            'Interpreta críticamente estos resultados guardados, sin inventar validez: '+JSON.stringify(run),'draft')}>Analizar</button>}
          <button type="button" className={css.danger} onClick={()=>{
            if(confirmDelete!==run.id){setConfirmDelete(run.id);return}
            if(removeSmartRun(run.id)){setRuns(savedRuns());setMessage('Resultado eliminado.')}
            else setMessage('No se pudo eliminar el resultado.')
            setConfirmDelete(null)
          }}>Eliminar{confirmDelete===run.id?' (confirmar)':''}</button>
        </div>
      </article>)}
      <p className={css.footnote}>Almacenamiento local sin sincronización, no apto como expediente clínico.</p>
    </div>}
    {message&&<p className={css.message} role="status">{message}</p>}
  </section>
}
