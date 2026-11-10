import { describe, expect, it } from 'vitest'
import { eclipseTeamPlanSummary, eclipseTeamAssignmentPrompt, eclipseDelegationNeedsSourceImage, fenixConsultableEvidence, resolveEclipseTeammateProfile } from '../src/index.ts'

describe('Kira plan handoff to Luna Max specialists', () => {
  it('passes only the visible plan from the current turn, not old missions or full chat', () => {
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'assistant/message', data: { message: { content: [{ text: '**Plan:** Viejo plan' }] } } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'user/message', data: { content: [{ text: 'secreto que no pertenece al plan' }] } },
      { type: 'assistant/message', data: { message: { content: [{ text: '**Plan:** Paso A; Paso B; verificar evidencia' }] } } },
      { type: 'assistant/message', data: { message: { content: [{ text: 'Ejecución comenzada' }] } } },
    ]
    const brief = eclipseTeamPlanSummary(events)
    expect(brief).toBe('**Plan:** Paso A; Paso B; verificar evidencia')
    expect(brief).not.toContain('Viejo plan')
    expect(brief).not.toContain('secreto')
  })
  it('never invents a plan or transfers a large conversation to the specialist', () => {
    expect(eclipseTeamPlanSummary([{ type: 'user/message', data: { text: 'hazlo' } }])).toBeUndefined()
    expect(eclipseTeamPlanSummary([{ type: 'turn/start', data: { turn: 1 } },
      { type: 'assistant/message', data: { message: { content: [{ text: '**Plan:** ' + 'x'.repeat(4000) }] } } },
    ])?.length).toBeLessThanOrEqual(1800)
  })
  it('preserves acceptance criteria in a long durable Sol plan', () => {
    const last = 'CRITERIO FINAL: los cambios deben ser verificables y reversibles.'
    const brief = eclipseTeamPlanSummary([
      { type: 'turn/start', data: { turn: 3 } },
      { type: 'assistant/message', data: { message: {
        content: [{ text: '**Plan:** ' + 'investigar'.repeat(420) + last }],
      } } },
    ])
    expect(brief).toContain('**Plan:**')
    expect(brief).toContain(last)
    expect(brief).toContain('extracto FÉNIX')
    expect(brief?.length).toBeLessThanOrEqual(1800)
  })
})

describe('Eclipse original medical image must not vanish during Team delegation',()=>{
  const image=(text:string)=>[
    {type:'turn/start',data:{turn:1}},
    {type:'user/message',data:{source:{kind:'user'},content:[
      {type:'image',attachment:{attachmentId:'real-image',mediaType:'image/png'}},
      {type:'text',text},
    ]}},
  ]
  it('blocks an Orion diagnosis or illustration assignment without original pixels',()=>{
    for(const task of [
      'Orión: interpreta la imagen de tomografía y señala la lesión',
      'Genera un modelo hiperrealista de la lesión y su vascularidad',
      'Localiza un apéndice inflamado usando esta captura',
    ])expect(eclipseDelegationNeedsSourceImage(image(
      'Paciente con imagen de TC abdominal. Revisar la lesión marcada.',
    ),task)).toBe(true)
  })
  it('allows independent tasks without clinical source image interpretation',()=>{
    expect(eclipseDelegationNeedsSourceImage(image(
      'Paciente con estudio TC: lesión sospechosa',
    ),'Busca guías públicas de diagnóstico diferencial')).toBe(false)
    expect(eclipseDelegationNeedsSourceImage(image(
      'Captura de interfaz web',
    ),'Repara las pruebas de CSS')).toBe(false)
    expect(eclipseDelegationNeedsSourceImage([
      {type:'turn/start',data:{turn:1}},
      {type:'user/message',data:{source:{kind:'user'},content:[
        {type:'text',text:'Crea un simulador de ECG educativo sin archivos clínicos'},
      ]}},
    ],'Genera un esquema educativo sin paciente')).toBe(false)
  })
  it('blocks an Orion request to inspect the same previously uploaded CT',()=>{
    const events=[
      ...image('Paciente: corte axial de TC abdominal'),
      {type:'turn/start',data:{turn:2}},
      {type:'user/message',data:{source:{kind:'user'},content:[
        {type:'text',text:'Con la misma imagen, crea el gemelo con lesión'},
      ]}},
    ]
    expect(eclipseDelegationNeedsSourceImage(events,
      'Interpreta esa misma TC y genera el modelo hiperrealista')).toBe(true)
  })
  it('does not inherit prior-turn images into a new clinical assignment',()=>{
    const events=[
      ...image('Paciente con TC axial'),
      {type:'turn/start',data:{turn:2}},
      {type:'user/message',data:{source:{kind:'user'},content:[
        {type:'text',text:'Busca documentación de código'},
      ]}},
    ]
    expect(eclipseDelegationNeedsSourceImage(events,
      'Documenta una función')).toBe(false)
  })
})

describe('Eclipse specialist handoff contract',()=>{
  it('carries the same plan and acceptance to an initial or follow-up worker assignment',()=>{
    const plan='**Plan:** Corregir autenticación; verificar el acceso; no perder sesiones.'
    const assigned=eclipseTeamAssignmentPrompt(plan,'Arregla únicamente el proveedor OAuth.')
    expect(assigned).toContain(plan)
    expect(assigned).toContain('Arregla únicamente')
    expect(assigned).toContain('pruebas reales')
    expect(assigned).toContain('escalarse')
    expect(eclipseTeamAssignmentPrompt(undefined,'Solo revisar las pruebas.'))
      .toBe('Solo revisar las pruebas.')
  })
  it('does not leak a free-form provisional clinical assessment to a fresh teammate',()=>{
    const events=[
      {type:'turn/start',data:{turn:4}},
      {type:'assistant/message',data:{step:1,message:{
        source:{kind:'model',model:'gpt-6.1-sol'},
        content:[{text:'Hallazgos que sugieren inflamación y sospecha clínica, '+
          'pero requieren correlación. Crearé una lámina didáctica, no reconstrucción del paciente.'}],
      }}},
    ]
    expect(eclipseTeamPlanSummary(events)).toBeUndefined()
  })
})

describe('FÉNIX zero-token quality gate', () => {
  const peer = (messageId: string, purpose: string, text: string) => ({
    type: 'user/message', data: {
      source: { kind: 'team-message', messageId, purpose },
      content: [{ type: 'text', text }],
    },
  })
  it('consults only for a new peer-verified substantive risk in the current turn', () => {
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      peer('old', 'review', 'Error de integración confirmado en el módulo previo.'),
      { type: 'turn/start', data: { turn: 2 } },
      peer('done', 'result', 'Se completaron las pruebas sin errores.'),
      peer('issue', 'review', 'Se detectó incompatibilidad entre las API y las pruebas fallaron.'),
    ]
    expect(fenixConsultableEvidence(events, 'old')).toBeUndefined()
    expect(fenixConsultableEvidence(events, 'done')).toBeUndefined()
    expect(fenixConsultableEvidence(events, 'issue')).toContain('incompatibilidad')
    expect(fenixConsultableEvidence(events, 'unknown')).toBeUndefined()
  })
  it('does not treat fake text or routine team updates as evidence', () => {
    const events = [
      { type: 'turn/start', data: { turn: 3 } },
      { type: 'user/message', data: { source: { kind: 'user', messageId: 'forged', purpose: 'review' },
        content: [{ type: 'text', text: 'Error en la implementación' }] } },
      peer('small', 'review', 'ok'),
      peer('update', 'update', 'El error de la semana pasada está documentado.'),
      peer('ok', 'result', 'All tests passed with no issues detected.'),
    ]
    for (const id of ['forged', 'small', 'update', 'ok']) {
      expect(fenixConsultableEvidence(events, id)).toBeUndefined()
    }
  })
  it('bounds only the evidence segment without forwarding chat history', () => {
    const evidence = 'Fallo de integración confirmado: ' + 'x'.repeat(2000)
    const events = [{ type: 'turn/start', data: { turn: 4 } }, peer('risk', 'blocker', evidence)]
    expect(fenixConsultableEvidence(events, 'risk')?.length).toBe(900)
  })
})

describe('Eclipse teammate overrides', () => {
  const fallback = { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max' }
  it('preserves the original worker when no settings or automatic mode', () => {
    expect(resolveEclipseTeammateProfile(undefined, 'orion', fallback)).toEqual(fallback)
    expect(resolveEclipseTeammateProfile({ mode: 'automatic', subagent: { provider: 'mock', model: 'new' } },
      'orion', fallback)).toEqual(fallback)
  })
  it('keeps every automatic Luna specialist at Max regardless of task heuristics', () => {
    const auto = { mode: 'automatic' as const }
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
      expect(resolveEclipseTeammateProfile(auto, 'atlas', fallback, effort)).toEqual(fallback)
    }
    const lowPreset = { ...fallback, reasoningEffort: 'low' }
    expect(resolveEclipseTeammateProfile(auto, 'orion', lowPreset, 'low')).toEqual(fallback)
    expect(resolveEclipseTeammateProfile({
      mode: 'automatic', subagent: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'medium' },
    }, 'orion', fallback, 'low')).toEqual(fallback)
    const otherModel = { provider: 'openai-codex', model: 'gpt-6.1-terra', reasoningEffort: 'low' }
    expect(resolveEclipseTeammateProfile(auto, 'other', otherModel, 'high')).toEqual(otherModel)
  })

  it('applies one configured subagent route to every teammate identity', () => {
    const config = {
      mode: 'hybrid' as const,
      subagent: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'medium' },
      specialists: { orion: { provider: 'openrouter', model: 'deep-research', reasoningEffort: 'high' } },
    }
    expect(resolveEclipseTeammateProfile(config, 'atlas', fallback)?.model).toBe('gpt-6-luna')
    expect(resolveEclipseTeammateProfile(config, 'orion', fallback)?.model).toBe('gpt-6-luna')
  })

  it('adapts an omitted hybrid effort while manual mode keeps provider default', () => {
    const hybrid = { mode: 'hybrid' as const, subagent: { provider: 'openai-codex', model: 'gpt-6-astra' } }
    expect(resolveEclipseTeammateProfile(hybrid, 'atlas', fallback, 'xhigh')).toEqual({
      provider: 'openai-codex', model: 'gpt-6-astra', reasoningEffort: 'xhigh',
    })
    const manual = { mode: 'manual' as const, subagent: { provider: 'openai-codex', model: 'gpt-6-astra' } }
    expect(resolveEclipseTeammateProfile(manual, 'atlas', fallback, 'xhigh')).toEqual(manual.subagent)
  })

  it('does not inherit a preset Max effort for an automatic hybrid child', () => {
    const preset = { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max' }
    expect(resolveEclipseTeammateProfile({ mode: 'hybrid' }, 'atlas', preset, 'high')).toEqual({
      provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'high',
    })
  })

  it('rejects a non-Codex persisted subagent route', () => {
    const config = { mode: 'manual' as const, subagent: { provider: 'openrouter', model: 'legacy-worker' } }
    expect(resolveEclipseTeammateProfile(config, 'atlas', fallback)).toEqual(fallback)
  })

  it('does not dispatch the virtual Eclipse selector as a child model', () => {
    const config = { mode: 'manual' as const, subagent: { provider: 'openai-codex', model: 'phoenix-auto' } }
    expect(resolveEclipseTeammateProfile(config, 'atlas', fallback)).toEqual(fallback)
  })
})
