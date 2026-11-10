import { describe, expect, it } from 'vitest'
import { ReasoningEffortId, LlmAdapter } from '@phoenix-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@phoenix-ai/dsh-llm'
import { Context } from '@phoenix-ai/cordis'
import LlmRuntime from '@phoenix-ai/dsh-llm'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import { humanImageInTurn, selectVisualAnalysisRoute, selectClinicalVisualAnalysisRoute, installModelSelection, PHOENIX_CODEX_AUTO_MODEL } from '../src/model-selection.ts'
import { agentEvents } from '../src/dispatch.ts'
import type { Agent } from '../src/runtime-types.ts'

const low = { efforts: [{ id: ReasoningEffortId('low'), name: 'Low' }] }
const vision = (id: string, inputModalities: readonly ('text' | 'image')[] = ['text', 'image']) => ({
  provider: 'openai-codex', id, name: id, inputModalities, reasoning: low,
})

describe('Phoenix Auto image evidence routing', () => {
  it('detects an image in the human turn regardless of medical words or language', () => {
    const events = [
      { type: 'turn/start', data: { turn: 4 } },
      { type: 'user/message', data: { source: { kind: 'user' },
        content: [{ type: 'image', attachment: { attachmentId: 'source-image' } }] } },
    ]
    expect(humanImageInTurn(events, 4)).toBe(true)
    expect(humanImageInTurn(events, 3)).toBe(false)
  })

  it('ignores tool-created images and prior-turn attachments', () => {
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'image' }] } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'user/message', data: { source: { kind: 'user' },
        content: [{ type: 'text', text: 'Explica tu respuesta' }] } },
      { type: 'tool/result', data: { content: [{ type: 'image' }] } },
    ]
    expect(humanImageInTurn(events, 2)).toBe(false)
  })

  it('prefers a vision-capable Terra Low, never assuming Luna is the visual reader', () => {
    expect(selectVisualAnalysisRoute([
      vision('gpt-6.1-sol'),
      vision('gpt-6.1-terra'),
      vision('gpt-6-luna'),
    ])).toEqual({
      provider: 'openai-codex', model: 'gpt-6.1-terra', reasoningEffort: ReasoningEffortId('low'),
    })
  })

  it('falls back to Sol Low if Terra cannot actually see images or offer Low', () => {
    expect(selectVisualAnalysisRoute([
      vision('gpt-6.1-terra', ['text']),
      vision('gpt-6.1-sol'),
    ])?.model).toBe('gpt-6.1-sol')
    expect(selectVisualAnalysisRoute([
      { provider: 'openai-codex', id: 'gpt-6.1-terra', name: 'Terra',
        inputModalities: ['image'] as const,
        reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] } },
      vision('gpt-6.1-sol'),
    ])?.model).toBe('gpt-6.1-sol')
  })

  it('does not invent unavailable capabilities or select non-Codex models', () => {
    expect(selectVisualAnalysisRoute([
      vision('gpt-6.1-terra', ['text']),
      vision('gpt-6.1-sol', ['text']),
    ])).toBeUndefined()
    expect(selectVisualAnalysisRoute([
      { ...vision('gpt-6.1-terra'), provider: 'untrusted-model' },
    ])).toBeUndefined()
  })
})

class VisionCatalogAdapter extends LlmAdapter {
  constructor(private readonly terraHasImage = true) { super() }

  override providerInfo(provider: string) { return { id: provider, name: 'Codex' } }
  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([
      { provider: 'openai-codex', id: 'gpt-6.1-terra', name: 'Terra',
        inputModalities: this.terraHasImage ? ['text','image'] as const : ['text'] as const },
      { provider: 'openai-codex', id: 'gpt-6.1-sol', name: 'Sol',
        inputModalities: ['text','image'] as const },
    ])
  }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model,
      inputModalities: model === 'gpt-6.1-terra' && !this.terraHasImage
        ? ['text'] as const : ['text', 'image'] as const, reasoning: low })
  }
  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('clinical image turn continuity', () => {
  it('keeps the evidence specialist across later steps of an ECG reading', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['openai-codex'], new VisionCatalogAdapter(true))
    const events: Array<{ type: string; data: unknown }> = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { source: { kind: 'user' },
        content: [{ type: 'image', attachment: { attachmentId: 'ecg' } },
          { type: 'text', text: 'Interpreta este electrocardiograma' }] } },
    ]
    const agent = { options: {}, session: { events, header: { agentPreset:'kira-max' },
      append: (type: string, data: unknown) => { events.push({ type, data }) },
    } } as unknown as Agent
    ctx.agent = agent
    const dispose = installModelSelection(ctx, {
      current: { provider:'openai-codex', model:PHOENIX_CODEX_AUTO_MODEL }, assembled:undefined,
    })
    try {
      await ctx.systemPrompt.assemble()
      for (const step of [1,2,3]) {
        const routed = await agentEvents(ctx, agent).waterfall(
          'agent/request', {turn:1,step,signal:new AbortController().signal},
          () => Promise.resolve({provider:'seed',model:'seed'}),
        )
        expect(routed).toMatchObject({model:'gpt-6.1-terra',
          reasoningEffort:ReasoningEffortId('low')})
      }
    } finally { dispose(); await ctx.fiber.dispose() }
  })

  it('keeps an explicit Luna user selection and does not hijack code implementation', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['openai-codex'], new VisionCatalogAdapter(true))
    const events: Array<{ type:string; data:unknown }> = [
      { type:'turn/start', data:{turn:1} },
      { type:'user/message', data:{source:{kind:'user'},content:[
        {type:'image',attachment:{attachmentId:'ui-screenshot'}},
        {type:'text',text:'Arregla el código TypeScript de esta pantalla y ejecuta pruebas.'},
      ]} },
      { type:'agent/model-selection', data:{
        selection:{provider:'openai-codex',model:'gpt-6-luna'},
        source:'explicit',
      } },
    ]
    const agent = {options:{},session:{events,header:{agentPreset:'kira-max'},
      append:(type:string,data:unknown)=>{events.push({type,data})},
    }} as unknown as Agent
    ctx.agent = agent
    const dispose = installModelSelection(ctx, {
      current:{provider:'openai-codex',model:'gpt-6-luna'},assembled:undefined,
    })
    try {
      await ctx.systemPrompt.assemble()
      const routed = await agentEvents(ctx,agent).waterfall(
        'agent/request',{turn:1,step:2,signal:new AbortController().signal},
        ()=>Promise.resolve({provider:'seed',model:'seed'}),
      )
      expect(routed.model).toBe('gpt-6-luna')
    } finally { dispose(); await ctx.fiber.dispose() }
  })
})

describe('live image-specialist dispatch', () => {
  for (const [terraHasImage, expected] of [
    [true, 'gpt-6.1-terra'], [false, 'gpt-6.1-sol'],
  ] as const) {
    it('routes actual uploaded images to ' + expected + ' Low without a planning-only turn', async () => {
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(LlmRuntime)
      ctx.llm.registerAdapter(['openai-codex'], new VisionCatalogAdapter(terraHasImage))
      const events: Array<{ type: string; data: unknown }> = [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { source: { kind: 'user' }, content: [
          { type: 'image', attachment: { attachmentId: 'ecg-source' } },
          { type: 'text', text: 'Analiza las anormalidades de este trazado' },
        ] } },
      ]
      const agent = { options: {}, session: {
        events, header: { agentPreset: 'kira-max' },
        append: (type: string, data: unknown) => { events.push({ type, data }) },
      } } as unknown as Agent
      ctx.agent = agent
      const selection = { current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL },
        assembled: undefined }
      const dispose = installModelSelection(ctx, selection)
      try {
        const assembled = await ctx.systemPrompt.assemble()
        expect(assembled.sections.some(section => section.name === 'phoenix:auto-visible-handoff')).toBe(false)
        const routed = await agentEvents(ctx, agent).waterfall(
          'agent/request', { turn: 1, step: 1, signal: new AbortController().signal },
          () => Promise.resolve({ provider: 'seed', model: 'seed' }),
        )
        expect(routed).toMatchObject({
          provider: 'openai-codex', model: expected, reasoningEffort: ReasoningEffortId('low'),
        })
      } finally {
        dispose()
        await ctx.fiber.dispose()
      }
    })
  }
})

describe('clinical specialist selection is capability-driven rather than Terra Low by default',()=>{
  const model=(id:string,efforts:readonly ('low'|'medium'|'high')[])=>({
    provider:'openai-codex',id,name:id,inputModalities:['text','image'] as const,
    reasoning:{efforts:efforts.map(e=>({id:ReasoningEffortId(e),name:e}))},
  })
  it('prioritizes Sol High for medical images when genuinely supported',()=>{
    expect(selectClinicalVisualAnalysisRoute([
      model('gpt-6.1-terra',['low','high']),
      model('gpt-6.1-sol',['low','high']),
    ])).toMatchObject({model:'gpt-6.1-sol',reasoningEffort:ReasoningEffortId('high')})
  })
  it('uses Medium if High is unavailable, never fabricating model capability',()=>{
    expect(selectClinicalVisualAnalysisRoute([
      model('gpt-6.1-terra',['low']),
      model('gpt-6.1-sol',['medium']),
    ])).toMatchObject({model:'gpt-6.1-sol',reasoningEffort:ReasoningEffortId('medium')})
  })
  it('falls back to actual image-capable Low if higher effort is unavailable',()=>{
    expect(selectClinicalVisualAnalysisRoute([
      model('gpt-6.1-terra',['low']),
      model('gpt-6.1-sol',['low']),
    ])).toMatchObject({model:'gpt-6.1-terra',reasoningEffort:ReasoningEffortId('low')})
    expect(selectClinicalVisualAnalysisRoute([])).toBeUndefined()
  })
})
