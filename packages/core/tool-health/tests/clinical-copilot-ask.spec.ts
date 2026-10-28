import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import { CallId } from '@phoenix-ai/dsh-llm'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import UserQuestionService, { type AskUserQuestionRequest } from '@phoenix-ai/dsh-user-questions'
import * as HealthTool from '../src/index.ts'

async function clinic() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(HealthTool)
  return ctx
}

describe('Kira Clinical Copilot through existing ASK', () => {
  it('registers the tool and routes a sensitive mode choice to the genuine ASK service', async () => {
    const ctx=await clinic()
    const seen:AskUserQuestionRequest[]=[]
    ctx.userQuestions.registerProvider({
      async ask(request) {
        seen.push(request)
        return {answers:[{id:'health-ask-mode',selected:['Modo mixto']}]}
      },
    })
    const result=await ctx.tools.execute({
      callId:CallId('health-ask-mode-1'),signal:new AbortController().signal,
      name:'health_copilot_ask',arguments:{action:'choose_mode',pathway:'general'},
    })
    expect(result.isError).toBe(false)
    expect(ctx.tools.schemas().some(t=>t.name==='health_copilot_ask')).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.questions[0]).toMatchObject({id:'health-ask-mode',sensitive:true})
    expect(JSON.parse(String(result.value))).toMatchObject({
      status:'MODE_SELECTED',mode:'mixed',acceptedClinicalFact:false,savedToRecord:false,
    })
  })

  it('does not turn timed-out sensitive ASK into a patient fact or consent',async()=>{
    const ctx=await clinic()
    ctx.userQuestions.registerProvider({
      async ask(){return {automatic:true,answers:[{id:'health-ask-onset',selected:[]}]}}
    })
    const result=await ctx.tools.execute({
      callId:CallId('health-ask-expire-1'),signal:new AbortController().signal,
      name:'health_copilot_ask',arguments:{action:'next_question',pathway:'general'},
    })
    expect(result.isError).toBe(false)
    expect(JSON.parse(String(result.value))).toMatchObject({
      status:'UNANSWERED',acceptedClinicalFact:false,savedToRecord:false,
    })
  })

  it('rejects identifiable pathway arguments rather than forwarding them to ASK',async()=>{
    const ctx=await clinic()
    const seen:AskUserQuestionRequest[]=[]
    ctx.userQuestions.registerProvider({async ask(request){seen.push(request);return {answers:[]}}})
    const result=await ctx.tools.execute({
      callId:CallId('health-ask-invalid-1'),signal:new AbortController().signal,
      name:'health_copilot_ask',
      arguments:{action:'next_question',pathway:'Paciente Juan 809-555-2222'},
    })
    expect(result.isError).toBe(true)
    expect(seen).toHaveLength(0)
  })
})
