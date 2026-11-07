import { parseScaleForm, type ScaleFormSpec } from './ScaleForm.tsx'

/**
 * Evidence-bound instruments: provenance, wording language, scoring and access
 * are explicit. The registry contains only freely redistributable full items.
 * A protected/unknown instrument is discoverable, never silently fabricated.
 */
export interface AssessmentCatalogEntry {
  readonly id: string
  readonly title: string
  readonly discipline: 'medicina' | 'psicologia' | 'neuropsicologia' | 'universal'
  readonly sourceUrl: string
  readonly version: string
  readonly language: string
  readonly access: 'reproducible' | 'external-protocol' | 'license-required'
  readonly description: string
  readonly spec?: ScaleFormSpec
}
const common = [
  {label:'Ningún día (0)',score:0},{label:'Varios días (1)',score:1},
  {label:'Más de la mitad de los días (2)',score:2},
  {label:'Casi todos los días (3)',score:3},
]
// Wording follows the Spanish PHQ-9 presented by ISMMS; the respondent-facing
// timeframe and response options are provided in questionnaire metadata.
const phqItems = [
  'Tener poco interés o placer en hacer las cosas',
  'Sentirse desanimado/a, deprimido/a, o sin esperanza',
  'Con problemas en dormirse o en mantenerse dormida, o en dormir demasiado',
  'Sentirse cansado/a o tener poca energía',
  'Tener poco apetito o comer en exceso',
  'Sentir falta de amor propio o que sea un fracaso o que decepcionara a sí mismo/a o a su familia',
  'Tener dificultad para concentrarse en cosas tales como leer el periódico o mirar la televisión',
  'Se mueve o habla tan lentamente que otra gente se podría dar cuenta, o de lo contrario, está tan agitado/a o inquieto/a que se mueve mucho más de lo acostumbrado',
  'Se le han ocurrido pensamientos de que sería mejor estar muerta o de que se haría daño de alguna manera',
] as const
const gadItems = [
  'Sentirse nervioso/a, ansioso/a o con los nervios de punta',
  'No poder dejar de preocuparse ni controlar la preocupación',
  'Preocuparse demasiado por diferentes cosas',
  'Tener dificultades para relajarse',
  'Estar tan inquieto/a que le resulta difícil quedarse quieto/a',
  'Enojarse o irritarse fácilmente',
  'Sentir miedo como si fuera a suceder algo terrible',
] as const

function questionnaire(id:string,title:string,questions:readonly string[],version:string,
  source:string,sourceUrl:string,bands:readonly {max:number;label:string}[]):ScaleFormSpec {
  const spec={
    component:'scale_form',version:1,
    props:{
      title,version,source:source+' · '+sourceUrl,
      description:'Durante las últimas 2 semanas, indique la frecuencia de los síntomas. Registro orientativo; no es un diagnóstico.',
      population:'Personas para las que el profesional considere pertinente el instrumento.',
      administration:[
        {id:'prepare',title:'Preparación',instruction:'Confirmar idioma, versión, población y consentimiento. Explicar período de referencia de dos semanas.',phase:'prepare'},
        {id:'administer',title:'Cuestionario',instruction:'Administrar los '+questions.length+' ítems en el orden del instrumento; no sustituir la entrevista clínica.',phase:'administer'},
        {id:'score',title:'Puntuación',instruction:'Sumar las respuestas de 0 a 3. Evaluar funcionalidad y señales de seguridad por separado.',phase:'score'},
      ],
      scoring:{min:0,max:questions.length*3,direction:'higher-worse',
        note:'La puntuación describe síntomas autorreportados; no confirma un trastorno clínico.'},
      items:questions.map((question,index)=>({
        id:'q'+(index+1),question,help:'Frecuencia durante las últimas 2 semanas',
        options:common,
      })),
      bands:bands.map(b=>({...b,tone:'neutral'})),
    },
  }
  const parsed=parseScaleForm(spec)
  if (!parsed) throw Error('El catálogo contiene una definición inválida: '+id)
  return parsed
}

const phq9 = questionnaire('phq9','PHQ-9 · síntomas depresivos',phqItems,
  'PHQ-9, español · versión de referencia (verificar adaptación utilizada)',
  'Kroenke, Spitzer y Williams (2001) / ISMMS Spanish PHQ-9',
  'https://edinfo.mssm.edu/PHQ9Spanish',
  [{max:4,label:'Síntomas mínimos (0–4)'},{max:9,label:'Leves (5–9)'},
    {max:14,label:'Moderados (10–14)'},{max:19,label:'Moderadamente graves (15–19)'},
    {max:27,label:'Graves (20–27)'}])
const gad7 = questionnaire('gad7','GAD-7 · síntomas de ansiedad',gadItems,
  'GAD-7 · español, escala de cuatro respuestas (verificar adaptación utilizada)',
  'Spitzer et al. (2006) / Medical Spanish GAD-7',
  'https://www.medicalspanish.org/gad-7',
  [{max:4,label:'Mínimos (0–4)'},{max:9,label:'Leves (5–9)'},
    {max:14,label:'Moderados (10–14)'},{max:21,label:'Graves (15–21)'}])
const miniCog = parseScaleForm({
  component:'scale_form',version:1,props:{
    title:'Mini-Cog · registro del procedimiento y puntuación',
    version:'Mini-Cog©, referencia de puntuación oficial; usar hoja y traducción autorizadas',
    source:'Mini-Cog© official scoring · https://mini-cog.com/scoring-the-mini-cog/',
    population:'Cribado cognitivo según criterio y protocolo del profesional',
    description:'Registro posterior a la administración estandarizada. Este formulario NO reproduce los estímulos oficiales.',
    administration:[
      {id:'registration',title:'Registro de palabras',instruction:'Administrar la lista de palabras de la versión oficial autorizada, sin sustituirla por palabras inventadas.',phase:'prepare'},
      {id:'clock',title:'Dibujo del reloj',instruction:'Realizar el dibujo del reloj en papel según instrucciones oficiales; conservar el original en el expediente clínico.',phase:'administer'},
      {id:'recall',title:'Evocación diferida',instruction:'Registrar sin pistas el número de palabras recordadas y valorar el reloj con los criterios oficiales.',phase:'score'},
    ],
    scoring:{min:0,max:5,direction:'higher-better',note:'Cribado, no diagnóstico; considerar anamnesis y evaluación clínica.'},
    items:[
      {id:'recall',question:'Número de palabras recordadas sin ayuda',
        options:[{label:'0 palabras',score:0},{label:'1 palabra',score:1},
          {label:'2 palabras',score:2},{label:'3 palabras',score:3}]},
      {id:'clock',question:'Dibujo del reloj evaluado conforme al protocolo',
        options:[{label:'Anormal (0)',score:0},{label:'Normal (2)',score:2}]},
    ],
    bands:[{max:2,label:'Cribado positivo: precisa evaluación adicional',tone:'warning'},
      {max:5,label:'Menor probabilidad, sin excluir deterioro cognitivo',tone:'neutral'}],
  },
})
if(!miniCog) throw Error('Mini-Cog catalog inválido')

/** Clinical scores use concise source-derived component descriptors, not
 * copied proprietary pages. A score entry is not medical advice or diagnosis.
 */
const apgar=parseScaleForm({
  component:'scale_form',version:1,props:{
    title:'Apgar · valoración neonatal',
    version:'Apgar 1952 · componentes clínicos 0–2',
    source:'MedlinePlus · https://medlineplus.gov/spanish/ency/article/003402.htm',
    population:'Recién nacidos; evaluación por profesional capacitado.',
    description:'Registrar por separado a 1 y 5 minutos. Las acciones de reanimación se deciden clínicamente, no por esperar este total.',
    administration:[
      {id:'prepare',phase:'prepare',title:'Definir momento de evaluación',
        instruction:'Registrar el momento posnatal (1 o 5 minutos) en el contexto y no mezclar mediciones de momentos distintos.'},
      {id:'observe',phase:'administer',title:'Observación neonatal',
        instruction:'Evaluar los cinco componentes en el momento documentado según el procedimiento profesional.'},
      {id:'sum',phase:'score',title:'Puntuación y registro',
        instruction:'Sumar 0–2 por cada componente, total 0–10. Registrar respuestas y decisiones clínicas por separado.'},
    ],
    scoring:{min:0,max:10,direction:'higher-better',
      note:'La puntuación se describe junto a edad posnatal y situación clínica; no determina por sí sola la reanimación.'},
    items:[
      {id:'pulso',question:'Frecuencia cardíaca',
        options:[{label:'Sin latido (0)',score:0},{label:'Menos de 100/min (1)',score:1},
          {label:'100/min o más (2)',score:2}]},
      {id:'respiracion',question:'Esfuerzo respiratorio',
        options:[{label:'Ausente (0)',score:0},{label:'Lento o irregular (1)',score:1},
          {label:'Respiración eficaz o llanto vigoroso (2)',score:2}]},
      {id:'tono',question:'Tono muscular',
        options:[{label:'Flácido (0)',score:0},{label:'Algo de flexión (1)',score:1},
          {label:'Movimientos activos (2)',score:2}]},
      {id:'reflejos',question:'Respuesta refleja a la estimulación',
        options:[{label:'Ausente (0)',score:0},{label:'Mueca (1)',score:1},
          {label:'Retirada/llanto o tos/estornudo (2)',score:2}]},
      {id:'color',question:'Color de piel',
        options:[{label:'Palidez o cianosis generalizada (0)',score:0},
          {label:'Tronco rosado, extremidades azuladas (1)',score:1},
          {label:'Coloración rosada generalizada (2)',score:2}]},
    ],
    bands:[{max:3,label:'Puntuación baja: valorar contexto y respuesta clínica',tone:'warning'},
      {max:6,label:'Puntuación intermedia: evaluación clínica',tone:'warning'},
      {max:10,label:'Puntuación 7–10: registrar evolución',tone:'neutral'}],
  },
})
if(!apgar)throw Error('Apgar catalog inválido')

const glasgow=parseScaleForm({
  component:'scale_form',version:1,props:{
    title:'Glasgow · nivel de conciencia GCS',
    version:'Glasgow Coma Scale · E(1–4) V(1–5) M(1–6)',
    source:'Manual Merck profesional · https://www.merckmanuals.com/es-us/professional/multimedia/table/escala-de-coma-de-glasgow',
    population:'Pacientes cuya conciencia puede evaluarse con las tres respuestas observables.',
    description:'Registrar E, V y M por separado. Si un componente no es valorable (NT), no usar una suma total artificial.',
    administration:[
      {id:'prepare',phase:'prepare',title:'Verificar evaluabilidad',
        instruction:'Identificar intubación, sedación u otras limitaciones. Un componente no evaluable exige anotación externa, no puntuación ficticia.'},
      {id:'observe',phase:'administer',title:'Evaluar E, V y M',
        instruction:'Registrar la mejor respuesta ocular, verbal y motora observada según el procedimiento estandarizado.'},
      {id:'score',phase:'score',title:'Registrar componentes',
        instruction:'Sumar los componentes evaluables (3–15), registrar E/V/M y motivo de toda limitación.'},
    ],
    scoring:{min:3,max:15,direction:'higher-better',
      note:'Interpretar con el contexto neurológico y limitaciones; la escala no sustituye una evaluación neurológica.'},
    items:[
      {id:'ojos',question:'Respuesta ocular (E)',
        options:[{label:'Sin apertura (1)',score:1},{label:'Ante estímulo doloroso (2)',score:2},
          {label:'A la voz (3)',score:3},{label:'Espontánea (4)',score:4}]},
      {id:'verbal',question:'Respuesta verbal (V)',
        options:[{label:'Sin respuesta (1)',score:1},{label:'Sonidos incomprensibles (2)',score:2},
          {label:'Palabras inapropiadas (3)',score:3},{label:'Confuso pero conversa (4)',score:4},
          {label:'Orientado (5)',score:5}]},
      {id:'motora',question:'Respuesta motora (M)',
        options:[{label:'Sin respuesta (1)',score:1},{label:'Extensión anormal (2)',score:2},
          {label:'Flexión anormal (3)',score:3},{label:'Retirada al dolor (4)',score:4},
          {label:'Localiza estímulo (5)',score:5},{label:'Obedece órdenes (6)',score:6}]},
    ],
  },
})
if(!glasgow)throw Error('GCS catalog inválido')

const qsofa=parseScaleForm({
  component:'scale_form',version:1,props:{
    title:'qSOFA · alertas ante sospecha de infección',
    version:'Sepsis-3 2016 · evaluación rápida en adultos',
    source:'JAMA · https://jamanetwork.com/journals/jama/fullarticle/2492881',
    population:'Adultos con sospecha de infección; no sustituye SOFA ni evaluación de sepsis.',
    description:'Herramienta de alerta, no prueba para descartar sepsis si el resultado es bajo.',
    administration:[
      {id:'prepare',phase:'prepare',title:'Contexto',
        instruction:'Confirmar sospecha de infección, entorno clínico y fecha/hora de signos vitales.'},
      {id:'observe',phase:'administer',title:'Medir tres variables',
        instruction:'Registrar FR, presión arterial sistólica y estado mental con criterios qSOFA.'},
      {id:'score',phase:'score',title:'Resultado y acción',
        instruction:'Cada criterio presente suma 1; cualquier alarma clínica exige valoración sin depender del total.'},
    ],
    scoring:{min:0,max:3,direction:'higher-worse',
      note:'qSOFA bajo no descarta sepsis; no retrasar tratamiento, valoración ni escalamiento.'},
    items:[
      {id:'respiratoria',question:'Frecuencia respiratoria medida',
        options:[{label:'Menor de 22/min (0)',score:0},{label:'22/min o mayor (1)',score:1}]},
      {id:'presion',question:'Presión arterial sistólica',
        options:[{label:'Mayor de 100 mmHg (0)',score:0},{label:'100 mmHg o menor (1)',score:1}]},
      {id:'estado',question:'Estado mental',
        options:[{label:'Sin alteración nueva (0)',score:0},
          {label:'Alteración nueva o GCS menor de 15 (1)',score:1}]},
    ],
    bands:[{max:1,label:'0–1: no excluye infección grave o sepsis',tone:'neutral'},
      {max:3,label:'2–3: alerta, evaluación clínica y escalamiento',tone:'warning'}],
  },
})
if(!qsofa)throw Error('qSOFA catalog inválido')
export const assessmentCatalog:readonly AssessmentCatalogEntry[]=[
  {id:'apgar',title:apgar.props.title,discipline:'medicina',
    version:apgar.props.version!,language:'es',access:'reproducible',
    sourceUrl:'https://medlineplus.gov/spanish/ency/article/003402.htm',
    description:'5 componentes y 0–10 puntos; registro por momento posnatal.',spec:apgar},
  {id:'glasgow',title:glasgow.props.title,discipline:'medicina',
    version:glasgow.props.version!,language:'es',access:'reproducible',
    sourceUrl:'https://www.merckmanuals.com/es-us/professional/multimedia/table/escala-de-coma-de-glasgow',
    description:'E(1–4), V(1–5), M(1–6), total 3–15 si todas son evaluables.',spec:glasgow},
  {id:'qsofa',title:qsofa.props.title,discipline:'medicina',
    version:qsofa.props.version!,language:'es',access:'reproducible',
    sourceUrl:'https://jamanetwork.com/journals/jama/fullarticle/2492881',
    description:'3 criterios, 0–3 puntos; no descarta sepsis con resultado bajo.',spec:qsofa},
  {id:'phq9-es',title:phq9.props.title,discipline:'psicologia',
    version:phq9.props.version!,language:'es',access:'reproducible',
    sourceUrl:'https://edinfo.mssm.edu/PHQ9Spanish',
    description:'9 preguntas reales, puntuación 0–27 y advertencia ante el ítem 9.',spec:phq9},
  {id:'gad7-es',title:gad7.props.title,discipline:'psicologia',
    version:gad7.props.version!,language:'es',access:'reproducible',
    sourceUrl:'https://www.medicalspanish.org/gad-7',
    description:'7 preguntas reales, puntuación 0–21 y bandas descriptivas.',spec:gad7},
  {id:'mini-cog-register',title:miniCog.props.title,discipline:'neuropsicologia',
    version:miniCog.props.version!,language:'es',access:'external-protocol',
    sourceUrl:'https://mini-cog.com/scoring-the-mini-cog/',
    description:'Registro real 0–5 de prueba administrada según material oficial; no sustituye los estímulos.',spec:miniCog},
  {id:'moca',title:'MoCA · evaluación cognitiva',discipline:'neuropsicologia',
    version:'Consultar titular',language:'es',access:'license-required',
    sourceUrl:'https://mocacognition.com/',description:'Requiere acceso y capacitación según condiciones oficiales.'},
  {id:'mmse',title:'MMSE · Mini Mental State Examination',discipline:'neuropsicologia',
    version:'Consultar titular',language:'es',access:'license-required',
    sourceUrl:'https://www.parinc.com/',description:'No reproducir los ítems sin autorización de la versión correspondiente.'},
]
/** Browse validated instruments and controlled access without network calls. */
export function findAssessment(query:string): AssessmentCatalogEntry[] {
  const q=query.trim().toLocaleLowerCase('es')
  return assessmentCatalog.filter(e=>!q||[e.title,e.id,e.description,e.discipline].join(' ').toLocaleLowerCase('es').includes(q))
}
