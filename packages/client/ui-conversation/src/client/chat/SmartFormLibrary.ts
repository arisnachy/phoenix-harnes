import {
  parseSmartForm, type FormValue, type SmartExpr, type SmartFormSpec, type SmartResult,
} from './SmartFormEngine.ts'

/**
 * Single persisted version of a form.
 */
export interface SmartFormVersion {
  readonly spec: SmartFormSpec
  readonly revision: number
  readonly savedAt: string
}
/**
 * Saved form plus prior version snapshots.
 */
export interface SavedSmartForm extends SmartFormVersion {
  readonly history?: readonly SmartFormVersion[]
}
/**
 * Result snapshot recorded with explicit user authorization.
 */
export interface SavedSmartRun {
  readonly id: string
  readonly formId: string
  readonly revision: number
  readonly savedAt: string
  readonly inputs: Record<string, FormValue>
  readonly outputs: SmartResult['outputs']
}
const FORMS_KEY = 'phoenix.smart-form.library.v1'
const RUNS_KEY = 'phoenix.smart-form.results.v1'
const LIMIT = 160
const RUN_LIMIT = 100
const asObject = (x: unknown): x is Record<string,unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
function load(key: string): unknown {
  try {
    if (typeof localStorage === 'undefined') return null
    const value = localStorage.getItem(key)
    return value === null || value.length > 3_000_000 ? null : JSON.parse(value)
  } catch { return null }
}
function persist(key: string, value: unknown): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    localStorage.setItem(key,JSON.stringify(value))
    return true
  } catch { return false }
}
/**
 * Read and validate locally saved definitions.
 * @returns Current validated saved forms
 */
export function savedForms(): SavedSmartForm[] {
  const raw = load(FORMS_KEY)
  if (!Array.isArray(raw)) return []
  return raw.slice(0,LIMIT).flatMap((r:unknown) => {
    if (!asObject(r) || !Number.isInteger(r.revision) || Number(r.revision) < 1 ||
      typeof r.savedAt !== 'string') return []
    const spec = parseSmartForm(r.spec)
    const history: SmartFormVersion[] = Array.isArray(r.history)
      ? r.history.slice(0,10).flatMap((v:unknown) => {
        if (!asObject(v) || typeof v.savedAt !== 'string' ||
          !Number.isInteger(v.revision) || Number(v.revision) < 1) return []
        const prior = parseSmartForm(v.spec)
        return prior && prior.props.id === spec?.props.id
          ? [{spec:prior,revision:Number(v.revision),savedAt:v.savedAt}] : []
      }) : []
    return spec ? [{ spec, revision:Number(r.revision), savedAt:r.savedAt, history }] : []
  })
}
/**
 * Version and save a validated form locally.
 * @param spec - Definition to save
 * @returns Storage result and new revision
 */
export function saveSmartForm(spec: SmartFormSpec): { ok:boolean; revision:number } {
  const previous = savedForms()
  const existing = previous.find(r => r.spec.props.id === spec.props.id)
  const revision = (existing?.revision ?? 0) + 1
  const history = existing ? [
    {spec:existing.spec,revision:existing.revision,savedAt:existing.savedAt},
    ...(existing.history??[]),
  ].slice(0,10) : []
  const updated: SavedSmartForm = {spec,revision,savedAt:new Date().toISOString(),history}
  const others = previous.filter(r=>r.spec.props.id !== spec.props.id)
  return {ok:persist(FORMS_KEY,[updated,...others].slice(0,LIMIT)),revision}
}
/**
 * Delete a stored definition by ID.
 * @param id - Definition identifier
 * @returns True when persistence succeeds
 */
export function removeSmartForm(id: string): boolean {
  return persist(FORMS_KEY,savedForms().filter(f=>f.spec.props.id!==id))
}
/**
 * Read locally saved completed response sets.
 * @returns Previously recorded form runs
 */
export function savedRuns(): SavedSmartRun[] {
  const raw = load(RUNS_KEY)
  if (!Array.isArray(raw)) return []
  return raw.slice(0,RUN_LIMIT).flatMap((r:unknown) => {
    if (!asObject(r) || typeof r.id !== 'string' || typeof r.formId !== 'string'
      || typeof r.savedAt !== 'string' || !Number.isInteger(r.revision)
      || !asObject(r.inputs) || !Array.isArray(r.outputs)) return []
    return [{
      id:r.id,formId:r.formId,savedAt:r.savedAt,revision:Number(r.revision),
      inputs:r.inputs as Record<string,FormValue>,outputs:r.outputs as SmartResult['outputs'],
    }]
  })
}
/** Runs and answers are stored only after an explicit save; never automatically. */
/**
 * Save a completed response only after explicit UI authorization.
 * @param spec - Validated form
 * @param values - User-submitted answers
 * @param result - Calculated values
 * @returns True when persistence succeeds
 */
export function saveSmartRun(
  spec: SmartFormSpec, values: Record<string,FormValue>, result: SmartResult,
): boolean {
  if (!result.ready) return false
  const revision = savedForms().find(f=>f.spec.props.id === spec.props.id)?.revision ?? 0
  const now = new Date().toISOString()
  const record:SavedSmartRun = {
    id:spec.props.id+'-'+now, formId:spec.props.id,revision,savedAt:now,
    inputs:{...values},outputs:result.outputs,
  }
  return persist(RUNS_KEY,[record,...savedRuns()].slice(0,RUN_LIMIT))
}
/**
 * Delete one stored run by ID.
 * @param id - Run identifier
 * @returns True when persistence succeeds
 */
export function removeSmartRun(id: string): boolean {
  return persist(RUNS_KEY,savedRuns().filter(r=>r.id!==id))
}
/**
 * Serialize definitions without exporting response history.
 * @returns Versioned importable JSON
 */
export function exportSmartForms(): string {
  return JSON.stringify({
    format:'phoenix-smart-form-library',version:1,exportedAt:new Date().toISOString(),
    forms:savedForms(), // intentionally EXCLUDES responses; they require separate opt-in.
  },null,2)
}
/** Import accepts definitions only, never imported results, scripts or arbitrary properties. */
/**
 * Validate and import a versioned definition archive atomically.
 * @param data - Untrusted JSON archive
 * @returns Success and imported count
 */
export function importSmartForms(data: string): {ok:boolean; count:number} {
  if (data.length > 2_000_000) return {ok:false,count:0}
  try {
    const parsed:unknown = JSON.parse(data)
    if (!asObject(parsed) || parsed.format !== 'phoenix-smart-form-library' ||
      parsed.version !== 1 || !Array.isArray(parsed.forms) || parsed.forms.length > LIMIT) return {ok:false,count:0}
    const existing = new Map(savedForms().map(r=>[r.spec.props.id,r]))
    let count=0
    for (const candidate of parsed.forms) {
      const spec = asObject(candidate) ? parseSmartForm(candidate.spec) : null
      if (!spec) return {ok:false,count:0}
      const old = existing.get(spec.props.id)
      existing.set(spec.props.id,{spec,revision:(old?.revision??0)+1,savedAt:new Date().toISOString()})
      count++
    }
    if (existing.size > LIMIT) return {ok:false,count:0}
    return {ok:persist(FORMS_KEY,[...existing.values()]),count}
  } catch { return {ok:false,count:0} }
}
/**
 * Build a lightweight catalog for a user-triggered model prompt.
 * @returns Definitions index without user response data
 */
export function libraryIndex(): readonly {
  id:string;title:string;kind:string;folder:string;tags:readonly string[];revision:number
}[] {
  return savedForms().map(({spec,revision})=>({
    id:spec.props.id,title:spec.props.title,kind:spec.props.kind,
    folder:spec.props.folder??'General',tags:spec.props.tags??[],revision,
  }))
}

const c = (n:number|string):SmartExpr => ({constant:n})
const f = (name:string):SmartExpr => ({field:name})
const op = (name:Exclude<SmartExpr,{constant:number|string|boolean}|{field:string}|{today:true}>['op'],
  ...args:SmartExpr[]):SmartExpr => ({op:name,args})

/** First-run catalog: illustrative entries. Published scales require review of version and licensing. */
/**
 * Built-in illustrative calculators and questionnaire.
 */
export const starterForms: readonly SmartFormSpec[] = [
  {
    component:'smart_form',version:1,
    props:{
      id:'calculadora_imc',title:'Índice de masa corporal (IMC)',kind:'calculator',
      folder:'Salud/Antropometría',tags:['IMC','peso','talla','salud'],
      description:'Cálculo orientativo para personas adultas. No interpreta composición corporal individual.',
      source:'OMS: IMC = peso (kg) / altura (m)²; categorías orientativas de adultos.',
      fields:[
        {id:'peso',type:'number',label:'Peso',unit:'kg',min:1,max:500,step:0.1},
        {id:'talla',type:'number',label:'Estatura',unit:'cm',min:50,max:260,step:0.1},
      ],
      outputs:[{
        id:'imc',label:'IMC',expression:op('div',f('peso'),op('pow',op('div',f('talla'),c(100)),c(2))),
        unit:'kg/m²',precision:1,
        bands:[
          {max:18.499,label:'Bajo peso (adultos)'},{max:24.999,label:'Rango habitual (adultos)'},
          {max:29.999,label:'Sobrepeso (adultos)'},{max:10000,label:'Obesidad (adultos)'},
        ],
      }],
    },
  },
  {
    component:'smart_form',version:1,
    props:{
      id:'calculadora_fum',title:'Edad gestacional desde FUM',kind:'calculator',
      folder:'Salud/Obstetricia',tags:['FUM','embarazo','edad gestacional','FPP'],
      description:'Estimación por fecha de última menstruación (FUM), suponiendo ciclo de 28 días. Debe contrastarse con ecografía y datos clínicos.',
      source:'Regla obstétrica convencional: FPP = FUM + 280 días; edad gestacional = días desde FUM / 7.',
      fields:[{id:'fum',label:'Primer día de la última menstruación',type:'date'}],
      outputs:[
        {id:'semanas',label:'Semanas completas',expression:op('floor',op('div',op('days_between',f('fum'),{today:true}),c(7))),unit:'semanas',precision:0,
          bands:[{max:-1,label:'FUM posterior a la fecha actual: verificar'}]},
        {id:'dias',label:'Días adicionales',expression:op('mod',op('days_between',f('fum'),{today:true}),c(7)),unit:'días',precision:0},
        {id:'fpp',label:'Fecha probable de parto',expression:op('add_days',f('fum'),c(280))},
      ],
    },
  },
  {
    component:'smart_form',version:1,
    props:{
      id:'calculadora_cientifica',title:'Calculadora científica',kind:'scientific',
      folder:'Ciencia/Matemáticas',tags:['científica','trigonometría','potencias','logaritmos'],
      description:'Funciones trigonométricas con ángulos en radianes. Los resultados fuera del dominio se señalan.',
      fields:[
        {id:'x',label:'Valor x',type:'number',default:2,step:0.01},
        {id:'y',label:'Valor y',type:'number',default:3,step:0.01},
      ],
      outputs:[
        {id:'suma',label:'x + y',expression:op('add',f('x'),f('y')),precision:6},
        {id:'division',label:'x ÷ y',expression:op('div',f('x'),f('y')),precision:6},
        {id:'potencia',label:'x elevado a y',expression:op('pow',f('x'),f('y')),precision:6},
        {id:'raiz',label:'√x',expression:op('sqrt',f('x')),precision:6},
        {id:'logaritmo',label:'ln(x)',expression:op('ln',f('x')),precision:6},
        {id:'seno',label:'sen(x)',expression:op('sin',f('x')),precision:6},
        {id:'coseno',label:'cos(x)',expression:op('cos',f('x')),precision:6},
      ],
    },
  },
  {
    component:'smart_form',version:1,
    props:{
      id:'encuesta_rapida',title:'Encuesta breve de ejemplo',kind:'survey',
      folder:'Educación/Encuestas',tags:['Likert','encuesta','satisfacción'],
      description:'Ejemplo pedagógico de escala Likert. No es un instrumento psicométrico validado.',
      fields:[
        {id:'claridad',label:'La explicación fue clara',type:'radio',options:[
          {label:'Muy en desacuerdo',value:1},{label:'En desacuerdo',value:2},{label:'Neutral',value:3},
          {label:'De acuerdo',value:4},{label:'Muy de acuerdo',value:5},
        ]},
        {id:'utilidad',label:'La actividad fue útil',type:'radio',options:[
          {label:'Muy en desacuerdo',value:1},{label:'En desacuerdo',value:2},{label:'Neutral',value:3},
          {label:'De acuerdo',value:4},{label:'Muy de acuerdo',value:5},
        ]},
      ],
      outputs:[{id:'total',label:'Puntuación de ejemplo',expression:op('add',f('claridad'),f('utilidad')),unit:'de 10',precision:0}],
    },
  },
]
