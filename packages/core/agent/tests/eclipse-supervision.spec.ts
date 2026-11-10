import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import { ReasoningEffortId } from '@phoenix-ai/dsh-llm'
import { agentEvents, installModelSelection, PHOENIX_CODEX_AUTO_MODEL }
  from '../src/model-selection.ts'
import type { Agent } from '../src/runtime-types.ts'

async function fixture() {
  const ctx=new Context()
  await ctx.plugin(SystemPrompt)
  ctx.systemPrompt.tools(()=>({schemas:[{name:'read',description:'read evidence',parameters:{}}]}))
  const events:Array<{type:string;data:unknown}>=[
    {type:'turn/start',data:{turn:1}},
    {type:'user/message',data:{source:{kind:'user'},content:[{
      type:'text',text:'Investiga el fallo de producción, corrige el código, ejecuta las pruebas y demuestra el resultado.',
    }]}},
    {type:'assistant/message',data:{turn:1,step:1,message:{
      source:{kind:'model',model:'gpt-6.1-sol'},content:[{type:'text',
        text:'**Plan:** Verificar causa raíz; ejecutar reparación y pruebas; preservar criterios y entregar evidencia.'}],
    }}},
  ]
  const steered:unknown[]=[]
  const agent={options:{},session:{events,header:{agentPreset:'kira-max'},
    append:(type:string,data:unknown)=>events.push({type,data})},
    steer:(message:unknown)=>{steered.push(message)},
  } as unknown as Agent
  ctx.agent=agent
  const dispose=installModelSelection(ctx,{
    current:{provider:'openai-codex',model:PHOENIX_CODEX_AUTO_MODEL},assembled:undefined,
  })
  const signal=new AbortController().signal
  return {ctx,events,steered,signal,
    assemble:()=>ctx.systemPrompt.assemble(),
    request:(step:number)=>agentEvents(ctx,agent).waterfall(
      'agent/request',{turn:1,step,signal},
      ()=>Promise.resolve({provider:'seed',model:'seed'})),
    stop:()=>agentEvents(ctx,agent).serial('agent/turn-stopping',{turn:1,signal}),
    close:async()=>{dispose();await ctx.fiber.dispose()},
  }
}

describe('Eclipse Sol plan → Luna execution → Sol supervision',()=>{
  it('injects the exact current plan into the Luna step, not a rewritten one',async()=>{
    const s=await fixture()
    try {
      s.events.push({type:'step/start',data:{turn:1,step:1}})
      const assembled=await s.assemble()
      const brief=assembled.sections.find(x=>x.name==='phoenix:eclipse-execution-contract')?.text
      expect(brief).toContain('Verificar causa raíz')
      expect(brief).toContain('no reinicies ni debilites')
      expect((await s.request(2)).model).toBe('gpt-6-luna')
    } finally {await s.close()}
  })
  it('supervises once only after real tool evidence, ends on the actual Sol route',async()=>{
    const s=await fixture()
    try {
      await s.assemble()
      s.events.push(
        {type:'step/start',data:{turn:1,step:2}},
        {type:'tool/call',data:{turn:1,step:2,name:'read'}},
        {type:'tool/result',data:{turn:1,step:2,message:{content:[{
          type:'tool-result',isError:false,content:[{type:'text',text:'File fixed and tests passed: 12/12'}],
        }]}}},
        {type:'assistant/message',data:{turn:1,step:2,message:{
          source:{kind:'model',model:'gpt-6-luna'},
          content:[{type:'text',text:'Reparación completada, 12 pruebas correctas con evidencia registrada.'}],
        }}},
      )
      await s.stop()
      await s.stop()
      expect(s.steered).toHaveLength(1)
      expect(JSON.stringify(s.steered[0])).toContain('Eclipse supervision')
      const selected=await s.request(3)
      expect(selected.model).toBe('gpt-6.1-sol')
      expect(selected.reasoningEffort).toBe(ReasoningEffortId('medium'))
      const sections=await s.assemble()
      expect(sections.sections.find(x=>x.name==='phoenix:auto-visible-handoff')?.text)
        .toContain('final supervision pass')
      expect(sections.tools).toHaveLength(0)
      s.events.push({type:'assistant/message',data:{turn:1,step:3,
        message:{source:{kind:'model',model:'gpt-6.1-sol'},content:[{type:'text',
          text:'Resultado verificado: reparación y pruebas documentadas. Sin validación de producción externa.'}]}}})
      await s.stop()
      expect(s.steered).toHaveLength(1)
    } finally {await s.close()}
  })
  it('does not claim a final verification for a bare coordinator message or empty tool result',async()=>{
    const s=await fixture()
    try{
      await s.assemble()
      s.events.push({type:'assistant/message',data:{turn:1,step:2,message:{
        source:{kind:'model',model:'gpt-6-luna'},content:[{type:'text',
          text:'La implementación ya está lista, se probó exitosamente.'}]}}})
      await s.stop()
      expect(s.steered).toHaveLength(0)
    }finally{await s.close()}
  })
})
