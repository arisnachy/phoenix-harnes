/** Optional, read-only Kira Health Engine planning tools. No EHR access. */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import '@phoenix-ai/dsh-user-questions'
import { buildClinicalAskStep, interpretClinicalAsk, type ClinicalAskAction, type ClinicalAskPathway } from './clinical-copilot-ask.ts'
import { planInterview, planKiraMail, type InterviewMode } from './clinical-flow.ts'

export const name = 'tool-health'
export const inject = ['tools', 'systemPrompt', 'userQuestions']
const GUIDANCE = 'PHOENIX Health Engine: solo al solicitar una consulta o interrogatorio, usa health_interview_plan con motivo general SIN nombre, email, identificador u otros datos de paciente. Usa health_copilot_ask action=choose_mode para elegir mediante ASK entre Kira, médico o mixto. Luego action=screen_urgency antes de action=next_question. ASK solo gestiona preguntas y decisiones genéricas, sensibles y sin datos identificables; la respuesta clínica se introduce en el expediente autenticado /health. Un ASK expirado no acredita hechos, consentimiento, revisión ni registro.  El plan no es diagnóstico; recopila datos y exige evaluación del profesional para signos de alarma, examen, pruebas, tratamiento y firma. No afirmes que existe historia clínica guardada, receta firmada, correo enviado ni cita agendada. health_kira_mail_requirements solo enumera requisitos; no envía mensajes. El remitente debe ser la cuenta institucional de Kira autorizada, no una dirección inventada. No introduzcas historia clínica ni datos personales en memoria general, herramientas o logs sin un sistema clínico autorizado.'
function healthRequest(text: string | undefined): boolean {
  return typeof text === 'string' && /(?:consulta m[eé]dica|paciente|historia cl[ií]nica|interrogatorio|receta|health engine|kira.*consulta|psic[oó]log[oa]|laboratorio cl[ií]nico)/iu.test(text)
}
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name: 'tool:health', order: 119,
    text: assembly => healthRequest((assembly as { incomingUserText?: string }).incomingUserText) ? GUIDANCE : '' })
  ctx.tools.register(defineTool({
    name: 'health_copilot_ask',
    description: 'Activa el ASK original de PHOENIX para que médico y Kira elijan modo y coordinen preguntas clínicas genéricas. Nunca lee ni guarda el expediente, ni valida respuestas clínicas, consentimiento o firma. Usar solo con categorías sin identificadores.',
    parameters: {
      action: { type:'string', required:true, description:'choose_mode | screen_urgency | next_question; siempre pregunta sensible.' },
      pathway: { type:'string', description:'general | abdominal | headache | mental-health; sin nombre, fecha o datos del paciente.' },
      answeredFields: { type:'string', description:'Solo claves de preguntas ya registradas en el expediente protegido, separadas por coma, NUNCA sus respuestas.' },
    },
    output: { schema: { type:'string' }, render:(_args,value)=>[{ type:'text' as const,text:value }] },
    isConcurrencySafe: () => false,
    async execute(args,exec) {
      const answered = args.answeredFields === undefined ? [] :
        args.answeredFields.split(',').map(x=>x.trim()).filter(Boolean)
      const step=buildClinicalAskStep(args.action as ClinicalAskAction,
        (args.pathway??'general') as ClinicalAskPathway,answered)
      if(step.done) return JSON.stringify({
        status:'COMPLETE',acceptedClinicalFact:false,savedToRecord:false,
        clinicianReviewRequired:true,message:'Guía terminada: completar la evaluación y firma en PHOENIX Health.',
      })
      if(!step.question) throw new Error('La guía clínica no generó una pregunta válida.')
      const response=await ctx.userQuestions.ask({
        questions:[{
          id:step.question.id,header:step.question.header,question:step.question.question,
          sensitive:true,options:step.question.options.map(o=>({...o})),
        }],
        ...(exec.agent===undefined?{}:{agent:exec.agent}),
        signal:exec.signal,
      })
      const answer=response.answers.find(item=>item.id===step.question?.id)
      const selected=answer?.selected.length===1?answer.selected[0]:undefined
      return JSON.stringify(interpretClinicalAsk(step,selected,response.automatic===true))
    },
    presentCall:()=>({card:'generic',title:'Kira Clínica · ASK',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name: 'health_interview_plan',
    description: 'Propone hasta cuatro preguntas de interrogatorio por motivo general y especialidad; no almacena pacientes ni hace diagnósticos.',
    parameters: {
      complaint: { type: 'string', required: true, description: 'Motivo genérico, SIN nombres ni datos identificables del paciente.' },
      specialty: { type: 'string', description: 'Especialidad, por defecto general.' },
      mode: { type: 'string', description: 'kira | professional | mixed.' },
      answeredFields: { type: 'string', description: 'Claves de preguntas ya contestadas, separadas por comas, sin respuestas clínicas.' },
    },
    output: { schema: { type: 'string' }, render: (_args,value) => [{ type: 'text' as const, text: value }] },
    isConcurrencySafe: () => true,
    execute(args) {
      const fields = args.answeredFields ? args.answeredFields.split(',').map(x=>x.trim()).filter(Boolean) : []
      return Promise.resolve(JSON.stringify(planInterview(args.complaint, args.specialty ?? 'general',
        (args.mode ?? 'mixed') as InterviewMode, fields)))
    },
    presentCall: () => ({ card: 'generic', title: 'Preparar interrogatorio clínico', kind: 'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name: 'health_kira_mail_requirements',
    description: 'Lista las verificaciones necesarias para configurar notificaciones clínicas seguras; no ejecuta ningún envío.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args,value) => [{ type: 'text' as const,text:value }] },
    isConcurrencySafe: () => true,
    execute() {
      return Promise.resolve(JSON.stringify(planKiraMail({
        senderConnected:false, senderVerified:false, recipientVerified:false,
        patientConsent:false, clinicianSigned:false, clinicianAuthorizedSend:false,
        securePortalReady:false, idempotencyKeyPresent:false,
      })))
    },
    presentCall: () => ({ card: 'generic', title: 'Requisitos de comunicación clínica', kind: 'read' as const }),
  }))
}
