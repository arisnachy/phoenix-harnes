// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {AdaptiveAiFieldControl} from '../src/client/AdaptiveAiFieldControl.tsx'
import {readFieldAiConfig,saveFieldAiConfig,buildFieldAiMission,validateFieldResult,
  matchesFieldRequest} from '../src/client/AdaptiveIntelligentFields.ts'
import {parseAdaptiveControl} from '../src/client/AdaptiveWorkspaceControl.ts'

const appId='app-inventario',sectionId='inicio',fieldId='field-1'
const key='phoenix.adaptive.field-ai.v1.'+appId+'.'+sectionId+'.'+fieldId
function fakeStore(){const map=new Map<string,string>();return {
  getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},map}}
afterEach(()=>{cleanup();for(const suffix of ['','.backup','.rollback'])localStorage.removeItem(key+suffix)})
describe('Intelligent Field Engine',()=>{
  it('denies clinical scope and stores versioned metadata with rollback only',()=>{
    const store=fakeStore()
    expect(()=>readFieldAiConfig('healthia','consultation','history',store)).toThrow('FIELD_AI_SCOPE_DENIED')
    const c=readFieldAiConfig(appId,sectionId,fieldId,store)
    expect(c.enabled).toBe(false)
    const next=saveFieldAiConfig({...c,enabled:true,skill:'structure',instruction:'Usa solo hechos.',revision:1},store)
    expect(readFieldAiConfig(appId,sectionId,fieldId,store)).toEqual(next)
    expect(()=>saveFieldAiConfig(next,store)).toThrow('FIELD_AI_STALE_REVISION')
    expect(JSON.stringify([...store.map.values()])).not.toContain('patientName')
  })
  it('constructs bounded generic-only missions and rejects injections in config shape',()=>{
    const c={...readFieldAiConfig(appId,sectionId,fieldId),enabled:true}
    const request={appId,sectionId,fieldId,requestId:'field-1234567890000',expectedRevision:2,original:'Texto de prueba'}
    const mission=buildFieldAiMission(c,request)
    expect(mission).toContain('adaptive_field_result')
    expect(mission).toContain('Texto de prueba')
    expect(()=>buildFieldAiMission(c,{...request,original:''})).toThrow()
    const valid={appId,sectionId,fieldId,operation:'set-field-ai',expectedRevision:0,
      enabled:true,skill:'polish',instruction:'Mantener las unidades.'}
    expect(parseAdaptiveControl(valid)?.operation).toBe('set-field-ai')
    expect(parseAdaptiveControl({...valid,appId:'healthia'})).toBeNull()
    expect(parseAdaptiveControl({...valid,instruction:'<script>alert(1)</script>'})).toBeNull()
    expect(parseAdaptiveControl({...valid,eval:'yes'})).toBeNull()
  })
  it('requires matching request ID, revision and unchanged input for a result',()=>{
    const pending={appId,sectionId,fieldId,requestId:'field-1234567890000',expectedRevision:3,original:'Inicio'}
    const response={component:'adaptive_field_result' as const,version:1 as const,
      props:{appId,sectionId,fieldId,requestId:pending.requestId,expectedRevision:3,text:'Revisión'} }
    expect(validateFieldResult(response)).toBe(true)
    expect(matchesFieldRequest(response,pending,3,'Inicio')).toBe(true)
    expect(matchesFieldRequest(response,pending,4,'Inicio')).toBe(false)
    expect(matchesFieldRequest(response,pending,3,'Modificado')).toBe(false)
    expect(validateFieldResult({...response,props:{...response.props,appId:'healthia'}})).toBe(false)
    expect(validateFieldResult({...response,props:{...response.props,text:'',action:'exec'}})).toBe(false)
  })
  it('prepares a Kira draft and applies a suggestion only with explicit acceptance',()=>{
    const accept=vi.fn(),requests:any[]=[]
    const listener=(event:Event)=>requests.push((event as CustomEvent).detail)
    window.addEventListener('phoenix:adaptive-ai-field-draft',listener)
    try{
      render(<AdaptiveAiFieldControl appId={appId} sectionId={sectionId} fieldId={fieldId}
        formRevision={0} value="Texto original" maxLength={400} onAccept={accept}/>)
      fireEvent.click(screen.getByRole('button',{name:/Configurar IA/}))
      fireEvent.click(screen.getByRole('button',{name:'Guardar instrucciones'}))
      fireEvent.click(screen.getByRole('button',{name:'Proponer con Kira'}))
      expect(requests).toHaveLength(1)
      const req=requests[0] as {requestId:string}
      const result={component:'adaptive_field_result',version:1,props:{
        appId,sectionId,fieldId,requestId:req.requestId,expectedRevision:0,text:'Texto corregido'}}
      fireEvent(window,new CustomEvent('phoenix:adaptive-ai-field-proposal',{detail:result}))
      expect(accept).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button',{name:'Aceptar en el campo'}))
      expect(accept).toHaveBeenCalledWith('Texto corregido')
    }finally{window.removeEventListener('phoenix:adaptive-ai-field-draft',listener)}
  })
})
