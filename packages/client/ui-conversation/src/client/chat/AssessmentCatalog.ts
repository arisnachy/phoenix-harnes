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
const phqItems = [
  'Tener poco interés o placer en hacer las cosas',
  'Sentirse desanimado/a, deprimido/a o sin esperanza',
  'Tener problemas para dormirse, mantenerse dormido/a o dormir demasiado',
  'Sentirse cansado/a o tener poca energía',
  'Tener poco apetito o comer en exceso',
  'Sentirse mal consigo mismo/a, sentir que es un fracaso o que ha decepcionado a su familia',
  'Tener dificultad para concentrarse, por ejemplo, leyendo o mirando la televisión',
  'Moverse o hablar tan lentamente que otros lo noten, o estar mucho más inquieto/a de lo habitual',
  'Pensar que estaría mejor muerto/a o en hacerse daño de alguna manera',
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
export const assessmentCatalog:readonly AssessmentCatalogEntry[]=[
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
