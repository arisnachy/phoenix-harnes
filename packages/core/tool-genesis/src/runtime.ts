/**
 * Native PHOENIX Genesis bridge. Runs local institutional Workbench methods,
 * never guesses tool names or proxies through a non-existent MCP service.
 *
 * Demo data is isolated from the institution's production SQLite database.
 * Discovery is side-effect free: merely asking if Genesis exists never
 * creates a database. All document ingestion must use the reviewed console.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export type GenesisScope = 'institution' | 'demo'
export type GenesisOperation =
  | 'status' | 'demo-create' | 'organizations'
  | 'organization-create' | 'unit-register'
  | 'catalog' | 'report' | 'area-assess'

const BAD_INPUT = 'Genesis: solicitud incompleta o inválida'
function object(value: unknown, name: string): Record<string, unknown> {
  if(!value || typeof value !== 'object' || Array.isArray(value))
    throw Error(name+' debe ser objeto JSON')
  return value as Record<string, unknown>
}
function nonblank(value: unknown, name: string): string {
  if(typeof value!=='string'||value.trim()===''||value.length>300)
    throw Error(name+' debe ser texto no vacío')
  return value
}
function scopeOf(input: Record<string, unknown>): GenesisScope {
  const scope = input.scope ?? 'institution'
  if(scope !== 'institution' && scope !== 'demo')throw Error('Scope debe ser institution o demo')
  return scope
}
function projectRoot(): string {
  // The desktop Host may run with a different cwd than its installed runtime.
  // Resolve only known roots; never scan arbitrary user directories.
  const embeddedRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..')
  const candidates=process.env.PHOENIX_GENESIS_RUNTIME_ROOT
    ? [resolve(process.env.PHOENIX_GENESIS_RUNTIME_ROOT)]
    : [process.cwd(),embeddedRoot]
  for(const root of candidates)
    if(existsSync(join(root,'scripts','phoenix-genesis-workbench.mjs')))return root
  throw Error('Genesis nativo cargado, pero faltan scripts del Workbench en el runtime. '+ 
    'Configura PHOENIX_GENESIS_RUNTIME_ROOT con la raíz real de PHOENIX.')
}
async function modules(): Promise<Record<string, unknown>> {
  const base = join(projectRoot(),'scripts')
  const file = async (name: string): Promise<Record<string, unknown>> =>
    await import(pathToFileURL(join(base,name)).href) as Record<string, unknown>
  const [workbench,paths,demo,catalog,census,readiness] = await Promise.all([
    file('phoenix-genesis-workbench.mjs'), file('phoenix-genesis-paths.mjs'),
    file('phoenix-genesis-demo.mjs'),file('phoenix-genesis-healthcare-catalog.mjs'),
    file('phoenix-genesis-area-census.mjs'),file('phoenix-genesis-readiness-brief.mjs')
  ])
  return {workbench,paths,demo,catalog,census,readiness}
}
type GenesisWorkbenchLike = {
  close(): void
  organizations(): unknown
  createOrganization(spec: unknown): unknown
  unit(input: unknown): unknown
  dashboard(org: string): unknown
  poa(input: unknown): unknown
  deployment(org: string): unknown
  interview(org: string): unknown
}
type RuntimeConstructor = new(path: string) => GenesisWorkbenchLike
type Paths = {
  genesisDatabasePath(): string
  phoenixInstitutionDataDir(): string
}
function databasePath(paths: Paths, scope: GenesisScope): string {
  return scope==='demo'
    ? join(paths.phoenixInstitutionDataDir(),'demos','interactive','genesis.sqlite')
    : paths.genesisDatabasePath()
}
function ensureScopeDatabase(dbPath: string,scope: GenesisScope): void {
  if(!existsSync(dbPath))
    throw Error(scope==='demo'
      ? 'No existe demostración. Ejecuta primero genesis_demo_create.'
      : 'No existe una base institucional. Crea una organización desde genesis_organization_create o la consola.')
}
function result(action: GenesisOperation,scope: GenesisScope,value: unknown,write=false): Record<string, unknown> {
  return {tool:'native-genesis',action,scope,persisted:write,source:'local-sqlite',
    result:value}
}
/**
 * Public runtime engine used by the model-facing tools and Node 24 tests.
 * Values are returned only after the SQLite implementation succeeds.
 */
export async function runGenesis(operation: GenesisOperation,raw: unknown = {}): Promise<Record<string, unknown>> {
  const input=object(raw,BAD_INPUT)
  const scope=scopeOf(input)
  const root=projectRoot()
  if(operation==='status'){
    const s=join(root,'scripts')
    const required=[
      'phoenix-genesis-workbench.mjs','phoenix-genesis-demo.mjs',
      'phoenix-genesis-area-census.mjs','phoenix-genesis-healthcare-catalog.mjs',
      'phoenix-genesis-readiness-brief.mjs'
    ]
    const paths=await import(pathToFileURL(join(s,'phoenix-genesis-paths.mjs')).href) as Paths
    return result(operation,scope,{
      available:required.every(name=>existsSync(join(s,name))),
      mode:'native-tool-direct-local-runtime',scope,
      databaseExists:existsSync(databasePath(paths,scope)),
      demoAvailable:existsSync(databasePath(paths,'demo')),
      connectorsConnected:false,
      warning:'Herramienta nativa disponible, pero ni Fabric ni un HIS se consideran conectados sin comprobación separada.'
    })
  }
  const m=await modules()
  const paths=m.paths as Paths
  const dbPath=databasePath(paths,scope)
  if(operation==='demo-create'){
    if(scope!=='demo')throw Error('Para crear la demo indica scope: demo')
    const folder=join(paths.phoenixInstitutionDataDir(),'demos','interactive')
    if(existsSync(folder)){
      ensureScopeDatabase(dbPath,'demo')
      return result(operation,scope,{
        status:'already-existing',organizationId:'hospital_genesis_demo',
        instruction:'Consulta la organización con genesis_organization_report, scope demo.',
        source:'existing-demo-database',databaseExists:true
      },false)
    }
    mkdirSync(dirname(folder),{recursive:true,mode:0o700})
    const create=m.demo.createGenesisSyntheticDemo as (path: string) => unknown
    return result(operation,scope,create(folder),true)
  }
  if(operation==='organizations'&&!existsSync(dbPath)){
    return result(operation,scope,{organizations:[],databaseExists:false},false)
  }
  if(operation!=='organization-create')ensureScopeDatabase(dbPath,scope)
  if(operation==='organization-create'&&scope==='demo')
    throw Error('Las organizaciones de demostración se crean exclusivamente con genesis_demo_create')
  const Workbench = m.workbench.GenesisWorkbench as RuntimeConstructor
  const store=new Workbench(dbPath)
  try{
    if(operation==='organizations')
      return result(operation,scope,{organizations:store.organizations()},false)
    if(operation==='organization-create'){
      const spec=object(input.spec,'Especificación institucional')
      const created=store.createOrganization(spec)
      return result(operation,scope,{created,status:'created-and-persisted'},true)
    }
    const org=nonblank(input.organizationId,'organizationId')
    if(operation==='unit-register'){
      if(input.authorized!==true)throw Error('El registro de una unidad requiere autorización expresa')
      const unit=object(input.unit,'Unidad')
      if(unit.organizationId!==org)throw Error('La unidad debe pertenecer a la misma organización')
      const saved=store.unit(unit)
      return result(operation,scope,{saved,status:'registered-not-deployed'},true)
    }
    if(operation==='catalog'){
      const search=m.catalog.searchGenesisCatalog as (arg: unknown)=>unknown
      return result(operation,scope,search({
        industry:(store.dashboard(org) as {organization:{industry:string}}).organization.industry,
        category:nonblank(input.category,'Categoría'),
        query:typeof input.query==='string'?input.query:'',
        limit:40,offset:0
      }))
    }
    if(operation==='area-assess'){
      if(input.authorized!==true)throw Error('La evaluación requiere autorización expresa')
      const assess=m.census.assessGenesisArea as (store: unknown,arg:unknown)=>unknown
      const evaluation=object(input.assessment,'Evaluación')
      if(evaluation.organizationId!==org)throw Error('La evaluación pertenece a otra organización')
      return result(operation,scope,assess(store,evaluation),true)
    }
    if(operation==='report'){
      const kind=input.kind??'snapshot'
      if(kind==='snapshot')return result(operation,scope,store.dashboard(org))
      if(kind==='interview')return result(operation,scope,store.interview(org))
      if(kind==='poa')return result(operation,scope,store.poa({
        organizationId:org,period:nonblank(input.period,'Período YYYY-MM')
      }))
      if(kind==='deployment')return result(operation,scope,store.deployment(org))
      if(kind==='census'){
        const census=m.census.listGenesisAreaCensus as (store:unknown,org:string)=>unknown
        return result(operation,scope,census(store,org))
      }
      if(kind==='readiness'){
        const build=m.readiness.buildGenesisReadinessBrief as (store:unknown,org:string)=>unknown
        return result(operation,scope,build(store,org))
      }
      throw Error('Informe desconocido')
    }
    throw Error('Operación Genesis desconocida: '+operation)
  }finally{store.close()}
}
