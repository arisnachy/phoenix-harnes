import { describe,expect,it } from 'vitest'
import type { AdaptiveFormDraft } from '../src/client/AdaptiveAppCatalog.ts'
import { reconcileFormValues } from '../src/client/AdaptiveFormValueMigration.ts'
const field=(id:string)=>({id,label:id,kind:'text' as const,required:false,protected:false,binding:{destination:'local' as const,output:'inline' as const}})
const before:AdaptiveFormDraft={version:1,appId:'app-test',templateId:'section',revision:1,state:'local-draft',fields:[field('a'),field('b'),field('c')]}
describe('local form value migration',()=>{
  it('preserves unchanged stable IDs and isolates removed or newly externally bound values',()=>{
    const next:AdaptiveFormDraft={...before,revision:2,fields:[{...field('a'),label:'Renamed'},{...field('b'),binding:{destination:'chat',output:'chat'}}]}
    const draft={values:{a:'keep',b:'do not send',c:'removed'},recovery:[],overflow:false}
    const result=reconcileFormValues(before,next,draft)
    expect(result.values).toEqual({a:'keep'})
    expect(result.recovery.map(v=>v.value)).toEqual(['do not send','removed'])
    expect(draft.values.b).toBe('do not send')
    expect(()=>reconcileFormValues(before,{...next,appId:'app-other'},draft)).toThrow(/SCOPE/)
  })
})
