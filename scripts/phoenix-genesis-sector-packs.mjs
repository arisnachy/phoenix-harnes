/**
 * Genesis sector templates are proposals, not assertions that a department
 * exists, nor a claim that every organization requires every listed unit.
 * Core remains domain-neutral; new packs can be appended without rewriting it.
 */
const COMMON=[
  ['direccion','Dirección General','governance'],
  ['planificacion','Planificación y Desarrollo','planning'],
  ['finanzas','Finanzas y Presupuesto','finance'],
  ['rrhh','Recursos Humanos','human-resources'],
  ['tecnologia','Tecnologías y Sistemas','technology'],
  ['compras','Compras y Contrataciones','procurement'],
  ['almacen','Almacén y Abastecimiento','inventory'],
  ['calidad','Calidad, Riesgos y Cumplimiento','quality'],
  ['mantenimiento','Mantenimiento y Servicios Generales','facilities']
]
const PACKS={
  healthcare:[
    ['direccion_medica','Dirección Médica','clinical-governance'],
    ['consulta','Consultas Externas','clinical'],
    ['admision','Admisión y Archivo','admission'],
    ['urgencias','Urgencias y Triaje','emergency'],
    ['internamiento','Hospitalización y Camas','inpatient'],
    ['enfermeria','Enfermería','nursing'],
    ['uci','Cuidados Intensivos','critical-care'],
    ['quirófano','Quirófanos y Anestesia','surgery'],
    ['esterilizacion','Esterilización Central','sterilization'],
    ['farmacia','Farmacia Clínica','pharmacy'],
    ['laboratorio','Laboratorio y Patología','lab'],
    ['imagenes','Diagnóstico por Imágenes','imaging'],
    ['banco_sangre','Banco de Sangre y Transfusión','blood-bank'],
    ['nutricion','Nutrición Clínica','nutrition'],
    ['cocina','Alimentación y Cocina','catering'],
    ['lavanderia','Lavandería y Ropería','laundry'],
    ['bioingenieria','Ingeniería Biomédica','biomedical'],
    ['epi','Epidemiología y Vigilancia','epidemiology'],
    ['infecciones','Prevención de Infecciones','infection-prevention'],
    ['facturacion','Facturación y Aseguradoras','billing'],
    ['trabajo_social','Trabajo Social y Experiencia','social-work'],
    ['transporte','Ambulancias y Transporte','transport'],
    ['residuos','Residuos y Medioambiente','waste'],
    ['seguridad','Seguridad y Accesos','security'],
    ['parqueos','Parqueos y Movilidad','parking']
  ],
  restaurant:[
    ['salon','Salón y Mesas','front-of-house'],
    ['cocina','Cocina','production'],
    ['barra','Barra y Bebidas','beverage'],
    ['caja','Caja y Facturación','billing'],
    ['despacho','Despacho y Delivery','dispatch'],
    ['limpieza','Limpieza e Higiene','hygiene']
  ],
  education:[
    ['academica','Dirección Académica','academic'],
    ['admisiones','Admisiones y Registro','admission'],
    ['docencia','Docencia','teaching'],
    ['biblioteca','Biblioteca','library'],
    ['bienestar','Bienestar Estudiantil','welfare'],
    ['investigacion','Investigación','research']
  ],
  manufacturing:[
    ['produccion','Producción','production'],
    ['control_calidad','Control de Calidad','quality-control'],
    ['logistica','Logística','logistics'],
    ['seguridad_industrial','Seguridad Industrial','safety'],
    ['ingenieria','Ingeniería','engineering']
  ],
  retail:[
    ['ventas','Ventas','sales'],
    ['caja','Caja','cashier'],
    ['servicio','Atención al Cliente','customer-service'],
    ['distribucion','Distribución','distribution'],
    ['devoluciones','Devoluciones','returns']
  ],
  government:[
    ['servicios','Servicios al Ciudadano','public-service'],
    ['juridica','Asesoría Jurídica','legal'],
    ['transparencia','Transparencia y Rendición','transparency'],
    ['estadistica','Estadística y Datos','statistics'],
    ['cooperacion','Relaciones Interinstitucionales','partnerships']
  ]
}
export function genesisSectorFamily(value){
  const raw=String(value??'').trim().toLowerCase()
  if(/health|hosp|clinic|salud|medical|sanitari/u.test(raw))return 'healthcare'
  if(/restaur|food|gastronom|comida/u.test(raw))return 'restaurant'
  if(/univers|educa|coleg|school|acad/u.test(raw))return 'education'
  if(/manufact|industri|fabrica|factory/u.test(raw))return 'manufacturing'
  if(/retail|comerc|tienda|shop/u.test(raw))return 'retail'
  if(/gobierno|government|ministerio|public-sector|municipal/u.test(raw))return 'government'
  return 'universal'
}
export function suggestGenesisStructure(industry,siteId,knownUnits=[]){
  const family=genesisSectorFamily(industry)
  const current=new Set(knownUnits.map(x=>x.unitId))
  const entries=[...COMMON,...(PACKS[family]??[])]
  return {family,siteId,status:'unverified-proposals-only',
    note:'Sugerencias para entrevista y validación; NO crean departamentos, cargos o instancias reales.',
    units:entries.filter(([id])=>!current.has(id)).map(([unitId,name,role])=>({
      unitId,siteId,name,role,status:'suggested-not-verified',
      staffCount:null,workstations:null,requiresHumanAcceptance:true
    })) }
}
