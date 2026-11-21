// @vitest-environment jsdom
import {afterEach,describe,expect,it} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {AdaptiveFieldResultProposal,parseAdaptiveFieldResult} from '../src/client/chat/AdaptiveFieldResultProposal.tsx'
afterEach(cleanup)
const make=()=>({component:'adaptive_field_result',version:1,props:{
  appId:'app-inventario',sectionId:'inicio',fieldId:'field-1',requestId:'field-12345678900',
  expectedRevision:2,text:'Redacción propuesta',missingInformation:['Verificar unidad']}})
describe('Kira result routing to an exact app field',()=>{
  it('accepts only strict generic-app proposals',()=>{
    expect(parseAdaptiveFieldResult(make())?.props.text).toBe('Redacción propuesta')
    expect(parseAdaptiveFieldResult({...make(),props:{...make().props,appId:'healthia'}})).toBeNull()
    expect(parseAdaptiveFieldResult({...make(),props:{...make().props,text:'<script>not executable</script>',action:'eval'}})).toBeNull()
  })
  it('never changes the form automatically; stages a typed proposal on explicit click',()=>{
    const spec=parseAdaptiveFieldResult(make())!
    const events:unknown[]=[]
    const onRequest=(event:Event)=>events.push((event as CustomEvent).detail)
    window.addEventListener('phoenix:adaptive-ai-field-proposal',onRequest)
    try{
      render(<AdaptiveFieldResultProposal spec={spec}/>)
      expect(events).toHaveLength(0)
      fireEvent.click(screen.getByRole('button',{name:'Mostrar diferencia en el formulario'}))
      expect(events).toHaveLength(1)
      fireEvent(window,new CustomEvent('phoenix:adaptive-ai-field-result-ack',{
        detail:{requestId:spec.props.requestId,ok:true}}))
      expect(screen.getByText(/Propuesta presentada en el campo/)).toBeTruthy()
    }finally{window.removeEventListener('phoenix:adaptive-ai-field-proposal',onRequest)}
  })
})
