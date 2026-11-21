// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AdaptiveVisualStudio } from '../src/client/AdaptiveVisualStudio.tsx'
import { VISUAL_KINDS, readVisualBoard, applyVisualCommand, parseVisualCommand,
  preflightVisualCommand, restoreVisualBoard } from '../src/client/AdaptiveVisualKit.ts'

const appId='app-inventario',sectionId='inicio'
const prefix='phoenix.adaptive.visual.v1.'+appId+'.'+sectionId
function fakeStore(){
  const items=new Map<string,string>()
  return {items,getItem:(k:string)=>items.get(k)??null,setItem:(k:string,v:string)=>{items.set(k,v)}}
}
afterEach(()=>{cleanup();for(const suffix of ['','.backup','.rollback'])localStorage.removeItem(prefix+suffix)})

describe('PHOENIX Intelligent UI Kit',()=>{
  it('offers eight component kinds with no executable payload or backend assumptions',()=>{
    expect(Object.keys(VISUAL_KINDS)).toEqual(['metric','card','avatar','table','chart','calendar','timeline','alert'])
    expect(readVisualBoard(appId,sectionId).widgets).toEqual([])
  })
  it('rejects clinical workspace, unknown properties, and stale commands before writing',()=>{
    const store=fakeStore()
    expect(parseVisualCommand({appId:'healthia',sectionId,operation:'add-widget',widgetKind:'card',label:'Datos',expectedRevision:0})).toBeNull()
    expect(parseVisualCommand({appId,sectionId,operation:'add-widget',widgetKind:'script',label:'Datos',expectedRevision:0})).toBeNull()
    expect(parseVisualCommand({appId,sectionId,operation:'add-widget',widgetKind:'card',label:'Datos',expectedRevision:0,action:'eval(1)'})).toBeNull()
    const command={appId,sectionId,operation:'add-widget' as const,widgetKind:'table' as const,label:'Inventario',expectedRevision:0}
    expect(preflightVisualCommand(command,readVisualBoard(appId,sectionId,store)).valid).toBe(true)
    applyVisualCommand(command,store)
    expect(preflightVisualCommand(command,readVisualBoard(appId,sectionId,store))).toEqual({valid:false,reason:'VISUAL_STALE_REVISION'})
    expect(()=>applyVisualCommand(command,store)).toThrow('VISUAL_STALE_REVISION')
  })
  it('persists layout metadata only; supports resize, rename, reorder and recovery',()=>{
    const store=fakeStore()
    const command=(operation:'add-widget',widgetKind:'card'|'metric',label:string,expectedRevision:number)=>
      applyVisualCommand({appId,sectionId,operation,widgetKind,label,expectedRevision},store)
    command('add-widget','card','Resumen',0)
    command('add-widget','metric','Indicadores',1)
    expect(readVisualBoard(appId,sectionId,store).widgets.map(w=>w.kind)).toEqual(['card','metric'])
    const first=readVisualBoard(appId,sectionId,store).widgets[0]!
    applyVisualCommand({appId,sectionId,operation:'set-widget-span',widgetId:first.id,span:'full',expectedRevision:2},store)
    applyVisualCommand({appId,sectionId,operation:'move-widget',widgetId:first.id,direction:'down',expectedRevision:3},store)
    applyVisualCommand({appId,sectionId,operation:'rename-widget',widgetId:first.id,label:'Panel principal',expectedRevision:4},store)
    expect(readVisualBoard(appId,sectionId,store).widgets[1]?.title).toBe('Panel principal')
    const encoded=JSON.stringify([...store.items])
    expect(encoded).not.toContain('medicalRecord')
    store.items.set(prefix,'{invalid-json')
    expect(readVisualBoard(appId,sectionId,store).revision).toBe(5)
    restoreVisualBoard(appId,sectionId,store)
    expect(readVisualBoard(appId,sectionId,store).revision).toBe(4)
  })
  it('renders editable responsive preview and preserves data-free placeholder states',()=>{
    render(<AdaptiveVisualStudio appId={appId} sectionId={sectionId}/>)
    expect(screen.getByText('Tu pantalla está lista para diseñarse')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Explorar componentes'}))
    fireEvent.change(screen.getByRole('textbox',{name:'Título de componente'}),{target:{value:'Visión general'}})
    fireEvent.click(screen.getByRole('button',{name:'Añadir a pantalla'}))
    expect(screen.getByText('Visión general')).toBeTruthy()
    expect(readVisualBoard(appId,sectionId).widgets[0]?.kind).toBe('card')
    fireEvent.click(screen.getByRole('button',{name:'Cambiar ancho Visión general'}))
    expect(readVisualBoard(appId,sectionId).widgets[0]?.span).toBe('full')
    fireEvent.click(screen.getByRole('button',{name:'Quitar Visión general'}))
    expect(readVisualBoard(appId,sectionId).widgets).toEqual([])
  })
})
