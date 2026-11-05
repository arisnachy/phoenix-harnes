import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  calculateSmartForm, initialSmartValues, parseSmartForm, parseSmartLibrary,
} from '../src/client/chat/SmartFormEngine.ts'
import {
  exportSmartForms, importSmartForms, libraryIndex, saveSmartForm, saveSmartRun,
  savedForms, savedRuns, starterForms,
} from '../src/client/chat/SmartFormLibrary.ts'
import { parseGenerativeUiBlock, splitGenerativeUiText } from '../src/client/chat/GenerativeUi.tsx'

describe('universal PHOENIX smart forms', () => {
  it('validates every starter and renders it through the existing native UI contract', () => {
    for (const form of starterForms) {
      expect(parseSmartForm(form)).not.toBeNull()
      expect(parseGenerativeUiBlock(form)).not.toBeNull()
      const fence = String.fromCharCode(96).repeat(3)
      const segments = splitGenerativeUiText('Resultado:\n'+fence+'generative-ui\n'+JSON.stringify(form)+'\n'+fence)
      expect(segments.some(part=>part.kind==='ui' && part.block.component==='smart_form')).toBe(true)
    }
    expect(parseSmartLibrary({component:'smart_form_library',version:1,props:{title:'Biblioteca'}})).not.toBeNull()
  })
  it('refuses calculators without formulas or input-dependent outputs', () => {
    const bmi = starterForms[0]!
    expect(parseSmartForm({ ...bmi, props: { ...bmi.props, outputs: [] } })).toBeNull()
    expect(parseSmartForm({ ...bmi, props: { ...bmi.props, outputs: undefined } })).toBeNull()
    expect(parseSmartForm({ ...bmi, props: { ...bmi.props, outputs: [
      { id:'imc',label:'IMC',expression:{constant:24.8} },
    ] } })).toBeNull()
    // An ordinary information-collection form may intentionally have no score.
    expect(parseSmartForm({ ...bmi, props: { ...bmi.props, kind:'form', outputs:[] } })).not.toBeNull()
  })

  it('calculates BMI without model callbacks', () => {
    const bmi=starterForms[0]!
    const result=calculateSmartForm(bmi,{peso:72,talla:180})
    expect(result.ready).toBe(true)
    expect(result.outputs[0]?.value).toBeCloseTo(22.2222222,5)
    expect(result.outputs[0]?.band).toBe('Rango habitual (adultos)')
    expect(calculateSmartForm(bmi,{peso:72}).ready).toBe(false)
    expect(calculateSmartForm(bmi,{peso:72,talla:0}).ready).toBe(false)
  })
  it('calculates FUM dates using calendar-day arithmetic', () => {
    const result=calculateSmartForm(starterForms[1]!,{fum:'2026-08-13'},'2026-11-05')
    expect(result.outputs.map(o=>o.value)).toEqual([12,0,'2027-05-20'])
    expect(calculateSmartForm(starterForms[1]!,{fum:'2026-02-30'}).ready).toBe(false)
  })
  it('contains scientific errors rather than propagating Infinity or NaN', () => {
    const form=starterForms[2]!
    const result=calculateSmartForm(form,{x:-4,y:0})
    expect(result.ready).toBe(true)
    expect(result.outputs.find(o=>o.id==='division')?.error).toBeTruthy()
    expect(result.outputs.find(o=>o.id==='raiz')?.value).toBeNull()
    expect(result.outputs.find(o=>o.id==='logaritmo')?.value).toBeNull()
    expect(initialSmartValues(form)).toEqual({x:2,y:3})
  })
  it('scores a numeric Likert survey', () => {
    expect(calculateSmartForm(starterForms[3]!,{claridad:5,utilidad:3}).outputs[0]?.value).toBe(8)
  })
  it('rejects script props, unknown ops, missing refs, traversal and duplicate ids', () => {
    const bmi=starterForms[0]!
    expect(parseSmartForm({...bmi,props:{...bmi.props,script:'alert(1)'}})).toBeNull()
    expect(parseSmartForm({...bmi,props:{...bmi.props,fields:[
      {...bmi.props.fields[0],onChange:'steal()'},...bmi.props.fields.slice(1),
    ]}})).toBeNull()
    expect(parseSmartForm({...bmi,props:{...bmi.props,outputs:[
      {id:'loop',label:'loop',expression:{op:'eval',args:[{constant:1}]}}
    ]}})).toBeNull()
    expect(parseSmartForm({...bmi,props:{...bmi.props,outputs:[
      {id:'wrong',label:'wrong',expression:{field:'not_defined'}}
    ]}})).toBeNull()
    expect(parseSmartForm({...bmi,props:{...bmi.props,folder:'../../secrets'}})).toBeNull()
    expect(parseSmartForm({...bmi,props:{...bmi.props,fields:[...bmi.props.fields,...bmi.props.fields]}})).toBeNull()
  })
})
describe('versioned browser library and explicit result history', () => {
  beforeEach(()=>{
    const data=new Map<string,string>()
    vi.stubGlobal('localStorage',{
      getItem:(k:string)=>data.get(k)??null,
      setItem:(k:string,v:string)=>{data.set(k,v)},
      removeItem:(k:string)=>{data.delete(k)},
    })
  })
  it('saves, revisions, indexes, exports and imports without leaking responses', () => {
    const spec=starterForms[0]!
    expect(saveSmartForm(spec)).toEqual({ok:true,revision:1})
    expect(saveSmartForm(spec)).toEqual({ok:true,revision:2})
    expect(libraryIndex()).toMatchObject([{id:'calculadora_imc',revision:2}])
    const result=calculateSmartForm(spec,{peso:70,talla:170})
    expect(saveSmartRun(spec,{peso:70,talla:170},result)).toBe(true)
    expect(savedRuns()).toHaveLength(1)
    const exported=exportSmartForms()
    expect(exported).not.toContain('"inputs"')
    expect(importSmartForms(exported)).toEqual({ok:true,count:1})
    expect(savedForms()[0]?.revision).toBe(3)
  })
  it('rejects malicious imports atomically',()=>{
    const spec=starterForms[0]!
    expect(saveSmartForm(spec).ok).toBe(true)
    const bad=JSON.stringify({format:'phoenix-smart-form-library',version:1,forms:[
      {spec:starterForms[1]}, {spec:{...spec,props:{...spec.props,onload:'evil'}}},
    ]})
    expect(importSmartForms(bad).ok).toBe(false)
    expect(savedForms()).toHaveLength(1)
  })
})
