import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { planAnatomicalTwin } from './anatomy-planner.ts'
/** Optional, read-only Kira Health Engine planning tools. No EHR access. */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import '@phoenix-ai/dsh-user-questions'
import { buildClinicalAskStep, interpretClinicalAsk, type ClinicalAskAction, type ClinicalAskPathway } from './clinical-copilot-ask.ts'
import { planInterview, planKiraMail, type InterviewMode } from './clinical-flow.ts'

const ANATOMY_INSTALLER=fileURLToPath(new URL('../../../../scripts/phoenix-anatomy-auto.mjs',import.meta.url))
const ANATOMY_CATALOG=fileURLToPath(new URL('../../../../scripts/phoenix-anatomy-models.json',import.meta.url))
function prepareAnatomy():Promise<string>{
  if(!existsSync(ANATOMY_INSTALLER))return Promise.resolve(JSON.stringify({
    status:'unavailable',installer:ANATOMY_INSTALLER,note:'Not installed in this PHOENIX runtime'}))
  return new Promise(resolve=>{
    let output='',errors=''
    const task=spawn(process.execPath,[ANATOMY_INSTALLER,'--ensure'],{
      windowsHide:true,shell:false,env:process.env,
      stdio:['ignore','pipe','pipe'],
    })
    task.stdout?.on('data',(v:Buffer)=>{output+=v.toString('utf8').slice(0,8192)})
    task.stderr?.on('data',(v:Buffer)=>{errors+=v.toString('utf8').slice(0,2000)})
    task.once('error',(e:Error)=>resolve(JSON.stringify({status:'error',reason:e.message})))
    task.once('close',(code:number|null)=>{
      if(code!==0)return resolve(JSON.stringify({status:'error',exitCode:code,
        reason:errors.slice(0,2000)}))
      try{
        const receipt=JSON.parse(output) as Record<string,unknown>
        resolve(JSON.stringify({status:receipt.status,installer:ANATOMY_INSTALLER,
          detail:receipt,note:'started/running is not installed. Check health_anatomy_status later.'}))
      }catch{resolve(JSON.stringify({status:'error',reason:'Installer returned invalid receipt'}))}
    })
  })
}
export const name = 'tool-health'
export const inject = ['tools', 'systemPrompt', 'userQuestions']
const GUIDANCE = 'PHOENIX Health Engine: solo al solicitar una consulta o interrogatorio, usa health_interview_plan con motivo general SIN nombre, email, identificador u otros datos de paciente. Usa health_copilot_ask action=choose_mode para elegir mediante ASK entre Kira, médico o mixto. Luego action=screen_urgency antes de action=next_question. ASK solo gestiona preguntas y decisiones genéricas, sensibles y sin datos identificables; la respuesta clínica se introduce en el expediente autenticado /health. Un ASK expirado no acredita hechos, consentimiento, revisión ni registro.  El plan no es diagnóstico; recopila datos y exige evaluación del profesional para signos de alarma, examen, pruebas, tratamiento y firma. No afirmes que existe historia clínica guardada, receta firmada, correo enviado ni cita agendada. health_kira_mail_requirements solo enumera requisitos; no envía mensajes. Para estudios volumétricos y gemelos anatómicos usa health_anatomy_workflow; usa health_anatomy_models para el catálogo y health_anatomy_status para consultar dependencias locales. Si el usuario autorizó expresamente instalar las dependencias anatómicas, puedes usar health_anatomy_prepare. Su estado started/running NO acredita instalación: confirma con health_anatomy_status y no prometas archivo GLB sin comprobarlo. El plan no es una reconstrucción: la ejecución real requiere un archivo DICOM/NIfTI local y consentimiento clínico. Nunca inventes lesiones ni llames al GLB diagnóstico. El remitente debe ser la cuenta institucional de Kira autorizada, no una dirección inventada. No introduzcas historia clínica ni datos personales en memoria general, herramientas o logs sin un sistema clínico autorizado.'
function healthRequest(text: string | undefined): boolean {
  return typeof text === 'string' && /(?:consulta m[eé]dica|paciente|historia cl[ií]nica|interrogatorio|receta|health engine|kira.*consulta|psic[oó]log[oa]|laboratorio cl[ií]nico|gemelo anat[oó]mico|reconstrucci[oó]n 3d|dicom|tomograf[ií]a|resonancia magn[eé]tica)/iu.test(text)
}
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'health_anatomy_status',
    description: 'Consulta solo el estado de la instalación local de bibliotecas anatómicas; no lee pacientes ni archivos DICOM. No confundir instalación con validación clínica.',
    parameters: {},
    output: {schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(){
      const base=process.env.LOCALAPPDATA||homedir()
      const home=process.env.PHOENIX_ANATOMY_HOME||join(base,process.env.LOCALAPPDATA?'PHOENIX':'.phoenix','anatomy')
      const manifestFile=join(home,'manifest.json')
      const manifest=(()=>{
        try{
          const value: unknown=JSON.parse(readFileSync(manifestFile,'utf8'))
          if(value!==null&&typeof value==='object'&&'components' in value){
            return value as {components?: Record<string,{status?:string}>}
          }
        }catch{/* Optional installation may not be present. */}
        return null
      })()
      const components=Object.fromEntries(
        Object.entries(manifest?.components??{}).map(([key,value])=>[key,value.status??'unknown']))
      return Promise.resolve(JSON.stringify({
        installed:manifest!==null,components,clinicallyValidated:false,
        reconstructionRunner:'scripts/phoenix-anatomy-workbench.mjs',
        note:'Sin instalación funcional, planificar; nunca confirmar anatomía, diagnóstico o capacidad de un modelo sin imagen volumétrica.',
      }))
    },
    presentCall:()=>({card:'generic',title:'Estado del motor anatómico',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'health_anatomy_prepare',
    description:'Inicia el autoinstalador local de anatomía después de una solicitud explícita del usuario. Solo instala componentes disponibles y pesos abiertos; no autoriza licencias comerciales ni prueba un GLB. Iniciado no significa instalado.',
    parameters:{},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>false,
    execute(){return prepareAnatomy()},
    presentCall:()=>({card:'generic',title:'Preparar motor anatómico local',kind:'write' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'health_anatomy_models',
    description:'Consulta catálogo anatómico verificado por modalidad y muestra las licencias de los modelos; no significa que los pesos estén descargados ni que exista un modelo educativo GLB.',
    parameters:{},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(){
      try{
        const value=JSON.parse(readFileSync(ANATOMY_CATALOG,'utf8')) as Record<string,unknown>
        return Promise.resolve(JSON.stringify({status:'catalog-only',
          tasks:value.tasks, gaps:value.gaps,clinicallyValidated:false}))
      }catch{return Promise.resolve(JSON.stringify({status:'unavailable',reason:'Catalog missing in runtime'}))}
    },
    presentCall:()=>({card:'generic',title:'Catálogo de modelos anatómicos',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name: 'health_anatomy_workflow',
    description: 'Planifica un gemelo anatómico de cualquier sistema humano según modalidad; NO abre archivos, NO crea geometrías, NO diagnostica y NO toca expedientes. Úsala para explicar al médico qué estudios permiten una reconstrucción y cuáles solo generan hipótesis.',
    parameters: {
      region: { type:'string', required:true, description:'Órgano o sistema anatómico sin identificadores del paciente; e.g. brain, heart, lungs, bones, vessels, all.' },
      studies: { type:'string', required:true, description:'Modalidades genéricas: TC, angio-TC, RM, ecografía 3D, RX, ECG, analíticas. Nunca introducir datos identificables.' },
    },
    output: {schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(args) {return Promise.resolve(JSON.stringify(planAnatomicalTwin(args.region,args.studies)))},
    presentCall:()=>({card:'generic',title:'Plan anatómico 3D · evidencia',kind:'read' as const}),
  }))
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
          sensitive:true,options:step.question.options.map(o=>({ ...o })),
        }],
        ...(exec.agent===undefined?{}:{ agent:exec.agent }),
        signal:exec.signal,
      })
      const answer=response.answers.find(item=>item.id===step.question?.id)
      const selected=answer?.selected.length===1?answer.selected[0]:undefined
      return JSON.stringify(interpretClinicalAsk(step,selected,response.automatic===true))
    },
    presentCall:()=>({ card:'generic',title:'Kira Clínica · ASK',kind:'read' as const }),
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
