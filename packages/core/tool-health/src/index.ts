import { existsSync, readFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { planAnatomicalTwin } from './anatomy-planner.ts'
import { protocolFor } from './diagnostic-routing.ts'
import { reviewPreexcitationRequest } from './ecg-preexcitation.ts'
import { planClinicalVisualization } from './diagnostic-visualization.ts'
import { planClinicalTwinScene } from './clinical-twin-scene.ts'
import { auditDiagnosticConcordance } from './diagnostic-concordance.ts'
import { auditClinicalEvidenceDraft } from './clinical-evidence-quality.ts'
import {DIAGNOSTIC_INPUTS,DIAGNOSTIC_INPUT_GROUPS,DIAGNOSTIC_INPUT_COUNT} from './diagnostic-catalog.ts'
/** Optional, read-only Kira Health Engine planning tools. No EHR access. */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import '@phoenix-ai/dsh-user-questions'
import { buildClinicalAskStep, interpretClinicalAsk, type ClinicalAskAction, type ClinicalAskPathway } from './clinical-copilot-ask.ts'
import { planInterview, planKiraMail, type InterviewMode } from './clinical-flow.ts'

const ANATOMY_INSTALLER=fileURLToPath(new URL('../../../../scripts/phoenix-anatomy-auto.mjs',import.meta.url))
const ANATOMY_CATALOG=fileURLToPath(new URL('../../../../scripts/phoenix-anatomy-models.json',import.meta.url))
const ANATOMY_CONNECTOR_IDS=['slicerheart','monai-nnunet','totalsegmentator',
  'ohif-cornerstone','simvascular','opencarp','three-vtk'] as const
function prepareAnatomy(component?:string):Promise<string>{
  if(component!==undefined&&!ANATOMY_CONNECTOR_IDS.some(id=>id===component))
    return Promise.resolve(JSON.stringify({status:'error',reason:'Invalid anatomy component'}))
  if(component==='simvascular'||component==='opencarp')
    return Promise.resolve(JSON.stringify({status:'external',
      detail:'Configure official WSL2/Linux engine and validate with anatomy simulation doctor.'}))
  if(component!==undefined){
    if(!existsSync(ANATOMY_INSTALLER))return Promise.resolve(JSON.stringify({status:'unavailable'}))
    try{
      const child=spawn(process.execPath,[ANATOMY_INSTALLER,'--install-component',component],{
        windowsHide:true,shell:false,env:process.env,detached:true,stdio:'ignore'})
      child.on('error',()=>{})
      child.unref()
      return Promise.resolve(JSON.stringify({status:'started',component,
        note:'Installation scheduled, not verified. Recheck health_anatomy_status.'}))
    }catch{return Promise.resolve(JSON.stringify({status:'error',reason:'Cannot launch installer'}))}
  }
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
const GUIDANCE = 'PHOENIX Health Engine: solo al solicitar una consulta o interrogatorio, usa health_interview_plan con motivo general SIN nombre, email, identificador u otros datos de paciente. Usa health_copilot_ask action=choose_mode para elegir mediante ASK entre Kira, médico o mixto. Luego action=screen_urgency antes de action=next_question. ASK solo gestiona preguntas y decisiones genéricas, sensibles y sin datos identificables; la respuesta clínica se introduce en el expediente autenticado /health. Un ASK expirado no acredita hechos, consentimiento, revisión ni registro.  El plan no es diagnóstico; recopila datos y exige evaluación del profesional para signos de alarma, examen, pruebas, tratamiento y firma. No afirmes que existe historia clínica guardada, receta firmada, correo enviado ni cita agendada. health_kira_mail_requirements solo enumera requisitos; no envía mensajes. Para estudios volumétricos y gemelos anatómicos usa health_anatomy_workflow; usa health_anatomy_models para el catálogo y health_anatomy_status para consultar dependencias locales. Si el usuario autorizó expresamente instalar dependencias anatómicas, usa health_anatomy_prepare con component=slicerheart, monai-nnunet, totalsegmentator, ohif-cornerstone o three-vtk. SimVascular y openCARP requieren instalación externa verificada; no afirmes que se autoinstalan. Su estado started/running NO acredita instalación: confirma con health_anatomy_status y no prometas archivo GLB sin comprobarlo. El plan no es una reconstrucción: la ejecución real requiere un archivo DICOM/NIfTI local y consentimiento clínico. Nunca inventes lesiones ni llames al GLB diagnóstico. El remitente debe ser la cuenta institucional de Kira autorizada, no una dirección inventada. No introduzcas historia clínica ni datos personales en memoria general, herramientas o logs sin un sistema clínico autorizado. Para CUALQUIER entrada diagnóstica médica (radiología, ECG, neurofisiología, ultrasonido, TC/RM, medicina nuclear, endoscopia, oftalmología, dermatología, ORL, microbiología, hematología, laboratorio, pruebas genéticas/moleculares, biopsia/citología, medicina del sueño, obstetricia, análisis funcionales y escalas clínicas) primero identifica la modalidad exacta con health_diagnostic_catalog, después consulta health_diagnostic_protocol con su id y fuente. Si no está en el catálogo, selecciona other solo como NO EVALUADO y solicita un protocolo especializado; no generalices desde otra modalidad. Solo describe hallazgos de píxeles, ondas o cifras que REALMENTE hayas visto o que provengan de informes acreditados. Una captura, PDF, foto o malla 3D no implica lectura del estudio completo; nunca afirmes que interpretaste una imagen inaccesible. Después de formular una impresión PROVISIONAL basada en hallazgos realmente observados, comprueba mediante health_diagnostic_concordance la coherencia entre observaciones fuente, impresión y diferenciales; si BLOCK_UNSUPPORTED_INTERPRETATION, no la conviertas en diagnóstico confirmado ni en ilustración del paciente. Esta auditoría no lee píxeles y nunca reemplaza la inspección visual. Una captura parcial no impide comunicar una sospecha provisional sustentada. Cuando el usuario solicite una ilustración clínica o un archivo médico dé lugar al modo educativo visual automático después de su interpretación, usa health_diagnostic_visual_plan y comprueba datos fuente; si bloquea, no dibujes una representación que parezca el diagnóstico del paciente. Jamás crees una ilustración para evitar contestar la consulta diagnóstica. En ese caso, después de documentar hallazgos, localización y diagnóstico diferencial, usa health_clinical_twin_scene para redactar un contrato visual anotado antes de image_generation; no se trata de un motor que inspeccione el archivo ni de garantía de imagen. La forma anatómica dibujada NO debe confundirse con el paciente real. Antes de emitir una conclusión tranquilizadora con una imagen o reporte clínico, usa health_clinical_evidence_audit y verifica sus ausencias; esta auditoría documental no valida diagnóstico ni sustituye la revisión del médico. Analiza cada estudio desde cero en su modalidad y contexto: describe los hallazgos verificables por localización o derivación, contraste de hipótesis y signos críticos, sin seleccionar previamente una enfermedad. En ECG revisa ritmo, frecuencia, eje, intervalos calibrados cuando sean legibles, morfología QRS, ondas Q, segmento ST, T y distribución por derivaciones; distingue cambios de conducción, isquemia, secuelas, variaciones técnicas y otras explicaciones según la evidencia, sin dar una etiqueta preconcebida. Si la fotografía no permite medir, no inventes cifras ni atribuyas un diagnóstico a una supuesta onda delta no observada. Las herramientas específicas de una enfermedad se utilizan solamente si la hipótesis ya está sustentada por observaciones independientes; una herramienta no acredita lo que afirma examinar. Ante posible urgencia, indica valoración médica inmediata. Distingue observación directa, diagnóstico escrito en el reporte, hipótesis, incertidumbre y región no evaluable; no fabriques probabilidades ni diagnósticos definitivos. Si el archivo fuente no puede verse ni su texto extraerse realmente, declara NO ANALIZADO; si es legible, describe los hallazgos observables y ofrece impresión PROVISIONAL diferenciada del diagnóstico documentado. La ausencia de motor diagnóstico especializado impide afirmar validación automática, no impide una lectura cualitativa cautelosa de hallazgos realmente vistos. Si la fuente es insuficiente, explica exactamente por qué y solicita originales sin esconder los datos ya observables. Si observas posibles hallazgos críticos recomienda valoración clínica urgente, sin tranquilizar por ausencia aparente en una imagen parcial. La herramienta metadata no examina píxeles ni constituye diagnóstico.'
/** Short, unconditional first-pass guard for medical uploads, including an
 * image-only user message. PromptAssembly does not promise incomingUserText.
 * This rule does not access the image, and is not a diagnostic model. */
export const CLINICAL_VISION_BASELINE = [
  'Ante una imagen posiblemente médica, tu primera tarea es LEER Y RESPONDER sobre ESA fuente: no sustituir el análisis por un atlas ni por una ilustración creada.',
  'Comprueba si los píxeles de la imagen original están realmente en el contexto del modelo. Una referencia textual, miniatura omitida o herramienta de metadatos no equivale a ver el estudio; en ese caso indica NO ANALIZADO sin simular una inspección.',
  'Si la imagen está visible: (1) identifica modalidad, orientación/lateralidad y calidad, texto legible y región; (2) describe hallazgos positivos y negativos realmente visibles y sus localizaciones, distinguiendo los no evaluables; (3) ofrece una impresión PROVISIONAL y diagnósticos diferenciales priorizados cuando existan signos compatibles, con hallazgos a favor y en contra; (4) evalúa complicaciones visibles y necesidad de atención urgente; (5) precisa limitaciones y el estudio adicional necesario para confirmar extensión o etiología.',
  'No confundas una captura parcial con la serie completa: no excluyas enfermedad en regiones no visualizadas ni inventes signos, mediciones, calibración o probabilidades. Sin embargo, una captura pequeña no justifica por sí sola omitir una sospecha clínica fundada en signos visibles. Explica qué puede y qué no puede concluirse con esa resolución.',
  'Si hay un diagnóstico escrito en el informe, diferéncialo de tu interpretación visual independiente. No presentes una hipótesis como confirmación diagnóstica; tampoco ocultes hallazgos evidentes detrás de una negativa genérica.',
  'Para estudios radiológicos revisa anatomía, distribución, cambios de tejidos vecinos, signos directos e indirectos y principales alternativas según la modalidad. Para ECG revisa ritmo, frecuencia, eje, intervalos solo si están calibrados, QRS y cambios ST-T por derivación; no preselecciones una enfermedad.',
  'La concordancia y auditoría clínicas solo validan consistencia documental: no leen píxeles. SOLO DESPUÉS de responder clínicamente, si el usuario solicitó una visualización O si existe un hallazgo médico observable con estructura y localización verificables, usa health_diagnostic_visual_plan y health_clinical_twin_scene para preparar automáticamente un ATLAS EXPLICATIVO. Si ambos autorizan una ilustración educativa y image_generation está operativo, crea una imagen hiperrealista anatómica con etiquetas de la estructura y lesión o mecanismo, distinguiendo observación, informe e hipótesis. Para evitar imágenes engañosas, no marques una lesión cuando falten localización o fuente, y no inventes vasculatura. No generes dibujos, atlas ni reconstrucciones del paciente por iniciativa propia: la creación automática es SOLO un atlas docente, no la anatomía individual. La generación nunca debe bloquear ni reemplazar la respuesta diagnóstica textual; si el generador falla, comunica que no hay imagen.',
  'Si la imagen no llegó al modelo, está omitida por límites del proveedor o no se ve, identifica ese fallo específico y pide reenvío o una ruta de visión compatible. No atribuyas el fallo exclusivamente a los píxeles sin haber recibido el raster.',
  'Si el usuario ha solicitado gemelos visuales explicativos, tras responder sobre la fuente clínica invoca health_clinical_twin_scene con hallazgo, estructura y localización. Solo si devuelve ILLUSTRATION_SPEC_READY, y existe image_generation operativo, usa su renderPrompt para generar una imagen hiperrealista rotulada; verifica el raster real y la fidelidad anatómica. Para ECG representa fisiología eléctrica y territorios solo como hipótesis, nunca una coronaria culpable; para laboratorio representa mecanismos y analitos con unidades verificadas; para citología/histología representa células y tejido con alteraciones realmente documentadas. Distingue atlas educativo de reconstrucción del paciente, y si falta motor informa que no se generó imagen. No generes una ilustración en lugar de analizar la fuente.',
  'Una conclusión preliminar no sustituye evaluación profesional ni revisión del DICOM original cuando sea necesaria.',
].join(' ')
function healthRequest(text: string | undefined): boolean {
  return typeof text === 'string' && /(?:consulta m[eé]dica|paciente|historia cl[ií]nica|interrogatorio|receta|health engine|kira.*consulta|psic[oó]log[oa]|laboratorio cl[ií]nico|gemelo anat[oó]mico|reconstrucci[oó]n 3d|anatom[ií]a 3d|modelo 3d (?:del? )?(?:coraz[oó]n|cerebro|[oó]rgano)|segmentaci[oó]n anat[oó]mica|dicom|tomograf[ií]a|resonancia magn[eé]tica|ekg|ecg|electrocardiograma|radiograf[ií]a|rayos x|ecograf[ií]a|sonograf[ií]a|citolog[ií]a|histopatolog[ií]a|biopsia|gam[m]?agraf[ií]a|pet.?tc|spect|endoscopia|broncoscopia|colonosco|mamograf[ií]a|oftalmolog|dermatoscop|audiometr|espirometr|gasometr|cultivo|hemograma|coagulaci[oó]n|gen[eé]tica|secuenciaci[oó]n|microbiolog|polisomnograf|doppler|neurofisiolog|electromiograf|eeg|an[aá]lisis de imagen|interpreta.*(?:imagen|estudio|placa)|diagn[oó]stico.*(?:imagen|ekg|rx|tac|rm))/iu.test(text)
}
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name:'health_diagnostic_catalog',
    description:'Consulta un catálogo de 243 tipos de estudios médicos en 20 grupos y 23 familias. Permite buscar por nombre o filtrar por grupo. Es un catálogo de entrada, NO son algoritmos diagnósticos instalados.',
    parameters:{
      query:{type:'string',description:'Palabra a buscar en nombre/código de modalidad, opcional; no introducir nombres ni datos personales.'},
      group:{type:'string',description:'Filtrar por identificador de grupo; opcional.'},
    },
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(args){
      const query=(args.query??'').trim().toLocaleLowerCase().slice(0,80)
      const group=(args.group??'').trim()
      const matches=Object.values(DIAGNOSTIC_INPUTS).filter(x=>
        (!group||x.group===group)&&(!query||
          x.label.toLocaleLowerCase().includes(query)||x.id.includes(query)))
      return Promise.resolve(JSON.stringify({
        status:'CATALOG_ONLY_NOT_INTERPRETED',
        totalTypes:DIAGNOSTIC_INPUT_COUNT,
        groups:DIAGNOSTIC_INPUT_GROUPS.map(g=>({id:g.id,label:g.label,count:g.items.length})),
        matched:matches.length,
        entries:matches.slice(0,50),truncated:matches.length>50,
        clinicallyValidated:false,patientFilesRead:0,automatedDiagnoses:0,
        note:'Una modalidad reconocida NO demuestra que existan pesos especializados ni un motor aprobado. Pedir el estudio original y usar health_diagnostic_protocol.',
      }))
    },
    presentCall:()=>({card:'generic',title:'Catálogo de estudios clínicos · 243 tipos',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'health_clinical_evidence_audit',
    description:'Audita que una lectura clínica de ECG, radiografía o informe documente los hallazgos realmente observados por zona/derivación y sus límites antes de etiquetarla como normal o descartar enfermedades. No lee imágenes, no diagnostica y no sustituye revisión médica. Sin información personal.',
    parameters:{
      modality:{type:'string',required:true,description:'Modalidad de la fuente, por ejemplo ecg, xray, ct, mri o report.'},
      sourceKind:{type:'string',required:true,enum:['image','waveform','report','document'],
        description:'Tipo del archivo original realmente examinado.'},
      sourceReviewed:{type:'boolean',required:true,description:'TRUE solo si se accedió a los datos fuente; no basta una ilustración o un resumen inventado.'},
      sourceQuality:{type:'string',required:true,enum:['adequate','limited','unknown'],
        description:'Calidad real para estudiar cambios sutiles. Una miniatura puede ser limitada.'},
      calibration:{type:'string',required:true,enum:['verified','unverified','not-applicable'],
        description:'Las mediciones numéricas de ECG exigen calibración verificada.'},
      domains:{type:'array',required:true,description:'Dimensiones observadas por separado, sin diagnóstico predeterminado.',
        items:{type:'object',additionalProperties:false,properties:{
          domain:{type:'string',required:true,description:'P. ej. rhythm, rate, axis, intervals, qrs-morphology, repolarization, lead-distribution.'},
          status:{type:'string',required:true,enum:['assessed','not-assessable','not-reviewed']},
          evidence:{type:'string',required:true,description:'Hallazgo objetivo y localización, sin datos del paciente.'},
        }}},
      claim:{type:'string',required:true,enum:['provisional','unremarkable','acute-condition-excluded'],
        description:'Grado de la conclusión a auditar, no una orden de emitir ese diagnóstico.'},
      urgencyReviewed:{type:'boolean',required:true,description:'Se investigaron signos de alarma según la modalidad y el contexto disponible.'},
      impression:{type:'string',description:'Impresión provisional separada de la evidencia observada.'},
      differentials:{type:'array',items:{type:'string'},description:'Hipótesis alternativas basadas en la fuente, nunca un diagnóstico precargado.'},
      imageWidth:{type:'integer',description:'Anchura real en píxeles del archivo recibido, si se conoce.'},
      imageHeight:{type:'integer',description:'Altura real en píxeles del archivo recibido, si se conoce.'},
      prMs:{type:'number',description:'PR en ms, solo si se midió realmente sobre fuente calibrada.'},
      qrsMs:{type:'number',description:'QRS en ms, solo si se midió realmente sobre fuente calibrada.'},
    },
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(args){
      try { return Promise.resolve(JSON.stringify(auditClinicalEvidenceDraft(args))) }
      catch { return Promise.resolve(JSON.stringify({
        decision:'INVALID_EVIDENCE_METADATA',canIssueFinalDiagnosis:false,
        canExcludeAcuteDisease:false,clinicianReviewRequired:true,
        nextAction:'Corrige los metadatos de la fuente; no afirmes un diagnóstico ni ausencia de enfermedad.',
      })) }
    },
    presentCall:()=>({card:'generic',title:'Auditoría clínica · Evidencia y limitaciones',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'health_ecg_preexcitation_review',
    description:'Herramienta ESPECÍFICA, opcional: solo si el análisis clínico independiente ya plantea preexcitación/WPW, contrasta PR, QRS y onda delta con mediciones verificadas o indicios fotográficos explícitamente no confirmados. No lee píxeles ni genera diagnóstico.',
    parameters:{
      prMs:{type:'number',description:'Duración PR medida en ms, opcional; no inventar.'},
      qrsMs:{type:'number',description:'Duración QRS medida en ms, opcional; no inventar.'},
      deltaWave:{type:'string',description:'present | absent | not-assessable; basado en trazado original.'},
      source:{type:'string',description:'calibrated-12-lead | partial-image | uncalibrated | not-reviewed'},
      leadEvidence:{type:'string',description:'Derivaciones del ECG que muestran delta; nunca introducir nombre de paciente.'},
      rhythm:{type:'string',description:'sinus | irregular-wide-complex | other | unknown'},
      photoDeltaHint:{type:'string',description:'possible | not-seen | not-assessable. Solo indicio cualitativo; NO implica interpretación automatizada de píxeles.'},
      qualitativePrHint:{type:'string',description:'appears-short | not-apparently-short | not-assessable; NO es una medición PR.'},
      axisHint:{type:'string',description:'left | right | normal | unknown; eje solo NO excluye WPW.'},
      clinicianReviewed:{type:'boolean',required:true,description:'El médico revisó realmente el ECG original calibrado. No es cierto si Kira solo vio una fotografía.'},
    },
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(args){
      return Promise.resolve(JSON.stringify(reviewPreexcitationRequest(args)))
    },
    presentCall:()=>({card:'generic',title:'ECG · Preexcitación y WPW (evidencia)',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'health_diagnostic_concordance',
    description:'Audita correspondencia entre hallazgos observados, hipótesis propuestas, diferenciales, criticidad y visualización de cualquier estudio. No preselecciona enfermedades ni interpreta píxeles. Solo metadatos desidentificados.',
    parameters:{
      modality:{type:'string',required:true,description:'ID de la modalidad, p.ej. ecg, mri_brain, histopathology.'},
      sourceType:{type:'string',description:'waveform, image, pdf, dicom, numeric o unknown.'},
      sourceReviewed:{type:'boolean',required:true,description:'Se revisó realmente la fuente médica y no solo una imagen derivada.'},
      sourceCompleteness:{type:'string',description:'complete | partial | unknown.'},
      observedEvidence:{type:'string',description:'Hallazgos generales efectivamente observados; sin nombre, ID ni otro dato de paciente.'},
      proposedImpression:{type:'string',description:'Hipótesis diagnóstica provisional; no afirmar confirmación.'},
      differentialConsidered:{type:'string',description:'Principales diagnósticos diferenciales realmente contrastados con las observaciones fuente.'},
      intendedVisualization:{type:'string',description:'none | mechanism | patient-specific | educational | quantitative'},
      criticalFeaturesAssessed:{type:'boolean',description:'Se revisaron alertas y urgencia clínica.'},
      calibratedMeasurementsAvailable:{type:'boolean',description:'Solo verdadero si se midieron datos calibrados en el estudio fuente.'},
    },
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(args){return Promise.resolve(JSON.stringify(auditDiagnosticConcordance(args)))},
    presentCall:()=>({card:'generic',title:'Concordancia diagnóstica · evidencias y diferenciales',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'health_clinical_twin_scene',
    description:'Construye la especificación de un gemelo visual médico HIPERREALISTA rotulado y marcado por lesión para cualquier modalidad del catálogo. Solo después de leer la fuente, comparar diagnósticos diferenciales y documentar estructura/localización/hallazgos. No lee píxeles ni genera imágenes. Nunca atribuye arteria culpable desde un ECG ni lesión focal desde un analito aislado.',
    parameters:{
      modality:{type:'string',required:true,description:'ID exacto del catálogo, p.ej. ct, ecg, laboratory, cytology, histopathology.'},
      sourceKind:{type:'string',required:true,enum:['image','pdf','dicom','waveform','numeric','wsi','report','unknown'],description:'Tipo real de archivo clínico examinado.'},
      sourceReviewed:{type:'boolean',required:true,description:'TRUE solo si el original fue realmente accesible y revisado; declaración, no prueba automática.'},
      sourceCompleteness:{type:'string',enum:['complete','partial','unknown'],description:'Integralidad real de la fuente.'},
      finding:{type:'string',required:true,description:'Hallazgo observado o atribuido al informe, sin información identificativa.'},
      evidenceKind:{type:'string',required:true,enum:['observed','reported','hypothesis','none'],description:'Procedencia del hallazgo, sin afirmar confirmación autónoma.'},
      sourceLocation:{type:'string',description:'Plano, corte, derivación o región anatómica verificable. Sin localización no se dibuja lesión.'},
      affectedStructure:{type:'string',description:'Nombre anatómico correcto y verificado de la estructura a marcar.'},
      vascularFinding:{type:'string',description:'SOLO anomalía vascular descrita por la fuente; no inventar a partir de una lesión.'},
      neuralFinding:{type:'string',description:'SOLO hallazgo neural realmente sustentado por la fuente.'},
    },
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(args){return Promise.resolve(JSON.stringify(planClinicalTwinScene(args)))},
    presentCall:()=>({card:'generic',title:'Gemelo clínico · Atlas visual fundamentado',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'health_diagnostic_visual_plan',
    description:'Evaluación previa obligatoria para cualquier imagen o visualización clínica: evita crear una ilustración genérica que aparente representar la lesión real del paciente. Solo planifica; no analiza píxeles ni genera imágenes.',
    parameters:{
      modality:{type:'string',required:true,description:'ID exacto del catálogo clínico.'},
      sourceType:{type:'string',description:'image, pdf, dicom, waveform, numeric, other'},
      sourceReviewed:{type:'boolean',required:true,description:'El estudio original realmente fue revisado (no solo reconstrucción GLB).'},
      observedFindings:{type:'string',description:'Hallazgos observados y medidos, sin datos identificativos. No inventar.'},
      visualizationKind:{type:'string',description:'conceptual | anatomical | quantitative | patient-lesion'},
      patientSpecific:{type:'boolean',required:true,description:'El usuario solicita anatomía real de un paciente.'},
      verifiedSpatialGeometry:{type:'boolean',description:'Existe prueba geométrica verificada externamente a este plan.'},
      diagnosticUncertaintyAcknowledged:{type:'boolean',description:'Se reconocen las limitaciones.'},
    },
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(args){
      return Promise.resolve(JSON.stringify(planClinicalVisualization(args)))
    },
    presentCall:()=>({card:'generic',title:'Plan visual clínico · Evidencia primero',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'health_diagnostic_protocol',
    description:'Para cualquiera de las 243 modalidades reconocidas, identifica el archivo original y la secuencia de revisión específica a su familia. No abre archivos y no diagnostica. Usa health_diagnostic_catalog si no conoces el ID.',
    parameters:{
      modality:{type:'string',required:true,description:'ID exacto de salud: eg ecg, eeg, ct_perfusion, blood_culture, genetic_exome, spirometry, whole_slide_imaging, other. Buscar primero en health_diagnostic_catalog.'},
      sourceType:{type:'string',description:'image | pdf | dicom | waveform | numeric | glb | unknown'},
    },
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(args){
      return Promise.resolve(JSON.stringify(protocolFor(args.modality,args.sourceType??'unknown')))
    },
    presentCall:()=>({card:'generic',title:'Protocolo de revisión diagnóstica · evidencias',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name: 'health_anatomy_status',
    description: 'Consulta solo el estado de la instalación local de bibliotecas anatómicas; no lee pacientes ni archivos DICOM. No confundir instalación con validación clínica.',
    parameters: {},
    output: {schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(){
      if(!existsSync(ANATOMY_INSTALLER))return Promise.resolve(JSON.stringify({
        initialized:false,installed:false,coreReady:false,viewerReady:false,weightsReady:false,
        components:{},clinicallyValidated:false,note:'Anatomy installer missing from this runtime',
      }))
      const result=spawnSync(process.execPath,[ANATOMY_INSTALLER,'--status'],{
        encoding:'utf8',windowsHide:true,timeout:7000,maxBuffer:384*1024,
      })
      if(result.status!==0||!result.stdout)return Promise.resolve(JSON.stringify({
        initialized:false,installed:false,components:{},clinicallyValidated:false,
        note:'Could not verify runtime package installation',
      }))
      try{
        const state=JSON.parse(result.stdout) as {
          initialized?:boolean;installed?:boolean;coreReady?:boolean;
          viewerReady?:boolean;weightsReady?:boolean;
          components?:Record<string,{status?:string}>}
        const components=Object.fromEntries(Object.entries(state.components??{})
          .map(([key,value])=>[key,value.status??'unknown']))
        return Promise.resolve(JSON.stringify({
          initialized:state.initialized===true,installed:state.installed===true,
          coreReady:state.coreReady===true,viewerReady:state.viewerReady===true,
          weightsReady:state.weightsReady===true,components,clinicallyValidated:false,
          note:'Verified package/model files, not patient anatomy or clinical performance',
        }))
      }catch{return Promise.resolve(JSON.stringify({
        initialized:false,installed:false,components:{},clinicallyValidated:false,
        note:'Malformed anatomy installer verification output',
      }))}
    },
    presentCall:()=>({card:'generic',title:'Estado del motor anatómico',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'health_anatomy_prepare',
    description:'Inicia el autoinstalador local de componentes anatómicos autorizados por el usuario. Los SimVascular y openCARP externos exigen instalación oficial separada; started no significa instalado.',
    parameters:{component:{type:'string',description:'Opcional: slicerheart | monai-nnunet | totalsegmentator | ohif-cornerstone | three-vtk'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>false,
    execute(args){return prepareAnatomy(args.component)},
    presentCall:()=>({card:'generic',title:'Preparar motor anatómico local',kind:'execute' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'health_anatomy_connectors',
    description:'Consulta la situación local de los siete conectores anatómicos sin instalar nada ni leer pacientes.',
    parameters:{},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(){
      const base=process.env.LOCALAPPDATA||homedir()
      const home=process.env.PHOENIX_ANATOMY_HOME||
        join(base,process.env.LOCALAPPDATA?'PHOENIX':'.phoenix','anatomy')
      let state:Record<string,{status?:string}>={}
      try{
        const file=JSON.parse(readFileSync(join(home,'manifest.json'),'utf8')) as {
          schema?:number;components?:Record<string,{status?:string}>}
        if(file.schema===2)state=file.components??{}
      }catch{}
      const status=(...names:string[])=>names.every(id=>state[id]?.status==='installed')
      const entries=[
        {id:'slicerheart',installed:status('slicer','slicerheart'),role:'cardiac imaging'},
        {id:'monai-nnunet',installed:status('monai','nnunetv2'),role:'segmenters; pretrained task weights separate'},
        {id:'totalsegmentator',installed:status('totalsegmentator','weights_ct'),role:'CT baseline; not clinically validated'},
        {id:'ohif-cornerstone',installed:false,cornerstoneLibraries:status('cornerstone'),role:'Cornerstone package may exist; OHIF/PACS not deployed'},
        {id:'simvascular',installed:status('simvascular'),role:'external scientific engine'},
        {id:'opencarp',installed:status('opencarp'),role:'external scientific engine'},
        {id:'three-vtk',installed:status('viewer','vtkjs'),role:'3D viewer libraries'},
      ]
      return Promise.resolve(JSON.stringify({entries,clinicallyValidated:false,
        note:'Package installation does not prove a model or clinical task was completed. Verify real output.'}))
    },
    presentCall:()=>({card:'generic',title:'Motores anatómicos · estado',kind:'read' as const}),
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
  // Must apply even when the user attaches ONLY a medical image and no text.
  ctx.systemPrompt.section({ name:'tool:health-vision-baseline', order:118,
    text:()=>CLINICAL_VISION_BASELINE })
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
