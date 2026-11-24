/** Durable, declarative self-created tools. No eval, arbitrary code, external calls or grants. */
import { mkdir, readdir, lstat, readFile, writeFile, link, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'

const ID=/^[a-z][a-z0-9-]{0,47}$/u
const FILE=/^([a-z][a-z0-9-]{0,47})\.([1-9][0-9]{0,5})\.json$/u
const OPS=['add','subtract','multiply','divide','min','max','abs','round'] as const
type Op=typeof OPS[number]
type Obj=Record<string,unknown>
type Operand=number|string
type Step={id:string;op:Op;args:Operand[]}
type Recipe={id:string;name:string;inputs:string[];steps:Step[];output:string}
type Entry={schema:1;revision:number;recipe:Recipe;fixtureCount:number}
const object=(v:unknown):v is Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)
const id=(v:unknown):v is string=>typeof v==='string'&&ID.test(v)
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e100
const exact=(v:Obj,keys:string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k))
const safeTitle=(v:unknown):v is string=>typeof v==='string'&&v.length>=1&&v.length<=80&&v.trim()===v&&!/[<>\u0000-\u001f\u007f]/u.test(v)
const validRevision=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1&&v<=999999
function invalid(reason:string):never{throw Error('SELF_TOOL_'+reason)}

export function parseSelfRecipe(value:unknown):Recipe{
  if(!object(value)||!exact(value,['id','name','inputs','steps','output'])||!id(value.id)||!safeTitle(value.name)||!Array.isArray(value.inputs)||value.inputs.length<1||value.inputs.length>12||!Array.isArray(value.steps)||value.steps.length>32||!id(value.output))return invalid('INVALID_RECIPE')
  const inputs:string[]=[],seen=new Set<string>()
  for(const field of value.inputs){
    if(!id(field)||seen.has(field))return invalid('INVALID_INPUT')
    inputs.push(field);seen.add(field)
  }
  const steps:Step[]=[]
  for(const raw of value.steps){
    if(!object(raw)||!exact(raw,['id','op','args'])||!id(raw.id)||seen.has(raw.id)||!OPS.includes(raw.op as Op)||!Array.isArray(raw.args))return invalid('INVALID_STEP')
    const op=raw.op as Op
    if(raw.args.length!==(['abs','round'].includes(op)?1:2))return invalid('INVALID_ARITY')
    const args:Operand[]=[]
    for(const arg of raw.args){
      if(finite(arg)||(typeof arg==='string'&&seen.has(arg)))args.push(arg)
      else return invalid('UNKNOWN_OPERAND')
    }
    steps.push({id:raw.id,op,args});seen.add(raw.id)
  }
  if(!seen.has(value.output))return invalid('UNKNOWN_OUTPUT')
  return {id:value.id,name:value.name,inputs,steps,output:value.output}
}
export function runSelfRecipe(recipe:Recipe,raw:unknown):number{
  if(!object(raw)||!exact(raw,recipe.inputs))return invalid('INVALID_VALUES')
  const values=new Map<string,number>()
  for(const key of recipe.inputs){const v=raw[key];if(!finite(v))return invalid('NONFINITE_INPUT');values.set(key,v)}
  for(const step of recipe.steps){
    const args=step.args.map(v=>typeof v==='number'?v:values.get(v)!)
    const a=args[0]!,b=args[1]!
    let result:number
    switch(step.op){
      case 'add':result=a+b;break
      case 'subtract':result=a-b;break
      case 'multiply':result=a*b;break
      case 'divide':if(b===0)return invalid('DIVISION_BY_ZERO');result=a/b;break
      case 'min':result=Math.min(a,b);break
      case 'max':result=Math.max(a,b);break
      case 'abs':result=Math.abs(a);break
      case 'round':result=Math.round(a);break
    }
    if(!finite(result))return invalid('NONFINITE_RESULT')
    values.set(step.id,result)
  }
  return values.get(recipe.output)!
}
function testRecipe(recipe:Recipe,fixtures:unknown):number{
  if(!Array.isArray(fixtures)||fixtures.length<2||fixtures.length>12)return invalid('TWO_TO_TWELVE_FIXTURES_REQUIRED')
  const cases=new Set<string>()
  for(const test of fixtures){
    if(!object(test)||!exact(test,['values','expected'])||!finite(test.expected))return invalid('INVALID_FIXTURE')
    const actual=runSelfRecipe(recipe,test.values)
    if(Math.abs(actual-test.expected)>1e-9*Math.max(1,Math.abs(test.expected)))return invalid('FIXTURE_FAILED')
    cases.add(JSON.stringify(recipe.inputs.map(key=>(test.values as Obj)[key])))
  }
  if(cases.size<2)return invalid('DISTINCT_FIXTURES_REQUIRED')
  return fixtures.length
}
function parseEntry(raw:unknown):Entry{
  if(!object(raw)||!exact(raw,['schema','revision','recipe','fixtureCount'])||raw.schema!==1||!validRevision(raw.revision)||typeof raw.fixtureCount!=='number'||!Number.isInteger(raw.fixtureCount)||raw.fixtureCount<2||raw.fixtureCount>12)return invalid('INVALID_STORED_ENTRY')
  return {schema:1,revision:raw.revision,recipe:parseSelfRecipe(raw.recipe),fixtureCount:raw.fixtureCount}
}
/** Each revision is immutable. Concurrent saves use an exclusive hard-link publication. */
export class SelfToolLibrary{
  constructor(private readonly root:string){}
  private async ensure():Promise<void>{
    await mkdir(this.root,{recursive:true,mode:0o700})
    const stat=await lstat(this.root)
    if(!stat.isDirectory()||stat.isSymbolicLink())return invalid('UNSAFE_STORAGE')
  }
  private async entries():Promise<{entries:Entry[];invalidCount:number}>{
    await this.ensure()
    const files=(await readdir(this.root)).filter(name=>FILE.test(name))
    if(files.length>256)return invalid('LIBRARY_LIMIT')
    const entries:Entry[]=[];let invalidCount=0
    for(const filename of files){
      try{
        const path=join(this.root,filename),stat=await lstat(path)
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw Error('invalid')
        const entry=parseEntry(JSON.parse(await readFile(path,'utf8')))
        if(filename!==entry.recipe.id+'.'+entry.revision+'.json')throw Error('invalid')
        entries.push(entry)
      }catch{invalidCount++}
    }
    entries.sort((a,b)=>a.recipe.id.localeCompare(b.recipe.id)||b.revision-a.revision)
    return {entries,invalidCount}
  }
  async list(){
    const {entries,invalidCount}=await this.entries()
    const latest=new Map<string,Entry>()
    for(const entry of entries)if(!latest.has(entry.recipe.id))latest.set(entry.recipe.id,entry)
    return {tools:[...latest.values()].map(e=>({id:e.recipe.id,name:e.recipe.name,revision:e.revision,inputs:e.recipe.inputs,fixtureCount:e.fixtureCount,kind:'numeric-recipe',revisions:entries.filter(v=>v.recipe.id===e.recipe.id).map(v=>v.revision)})),invalidCount}
  }
  async get(toolId:string,revision?:number):Promise<Entry>{
    if(!id(toolId)||(revision!==undefined&&!validRevision(revision)))return invalid('INVALID_REFERENCE')
    const {entries}=await this.entries()
    const entry=entries.find(e=>e.recipe.id===toolId&&(revision===undefined||revision===e.revision))
    if(!entry)return invalid('NOT_FOUND')
    return entry
  }
  async save(raw:unknown,fixtures:unknown,expectedRevision:number):Promise<Entry>{
    const recipe=parseSelfRecipe(raw),fixtureCount=testRecipe(recipe,fixtures)
    const {entries,invalidCount}=await this.entries()
    if(invalidCount>0)return invalid('STORAGE_REQUIRES_REVIEW')
    const current=entries.find(e=>e.recipe.id===recipe.id)
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==(current?.revision??0))return invalid('STALE_REVISION')
    if(entries.length>=256||expectedRevision>=999999)return invalid('LIBRARY_LIMIT')
    const entry:Entry={schema:1,revision:expectedRevision+1,recipe,fixtureCount}
    const final=join(this.root,recipe.id+'.'+entry.revision+'.json')
    const temp=join(this.root,'.'+randomUUID()+'.tmp')
    try{
      await writeFile(temp,JSON.stringify(entry),{flag:'wx',mode:0o600})
      await link(temp,final)
    }finally{await unlink(temp).catch(()=>undefined)}
    const verified=await this.get(recipe.id,entry.revision)
    if(JSON.stringify(verified)!==JSON.stringify(entry))return invalid('VERIFY_FAILED')
    return verified
  }
  async execute(toolId:string,values:unknown,revision?:number){
    const entry=await this.get(toolId,revision)
    return {id:entry.recipe.id,revision:entry.revision,result:runSelfRecipe(entry.recipe,values)}
  }
}

export function registerSelfToolLibrary(ctx:Context):void{
  const root=join(resolve(process.env.DSH_HOME||join(homedir(),'.dsh')),'self-tool-library-v1')
  const library=new SelfToolLibrary(root)
  ctx.systemPrompt.section({name:'phoenix:self-tool-library',order:119,text:'When a user-authorized task reveals a missing reusable capability, proactively inspect existing tools and skills before building. For deterministic numeric operations, use phoenix_self_tool_library: list existing recipes, save only a reusable generic definition with at least two distinct synthetic fixtures, then run it and verify the real result. Reuse by stable ID across sessions and models; use exact revisions for updates or older versions. Never store patient values, personal data, secrets or real task inputs in definitions or fixtures. Actual run values are not persisted by this library. For richer tools or UI use the existing Cordis inspect/define/run workflow and normal authorized extension development for durable installation; dynamic Cordis packages alone are not a persistent library. Discover exact configuration owners and use their official validated settings operations only within current authorization; never write credentials or grant permissions as a self-improvement. Do not create a tool when an existing one is sufficient. Saving a recipe is not permission to invoke other services or change the core.'})
  ctx.tools.register(defineTool({
    name:'phoenix_self_tool_library',
    description:'Persistent local library of tested declarative numeric tools, shared across sessions. operation list: input_json {}; inspect: {id,revision?}; save: {recipe:{id,name,inputs:[id],steps:[{id,op,args:[number or earlier input/step ID]}],output},fixtures:[{values:{inputId:number},expected:number}],expectedRevision:0 for new or current revision for update}; run: {id,values,revision?}. Ops add/subtract/multiply/divide/min/max are binary; abs/round unary. At least two distinct synthetic fixtures must pass before saving. To use an older immutable version supply revision. No arbitrary code, external APIs, file access by recipe, credentials, clinical records or persistence of run inputs.',
    parameters:{operation:{type:'string',required:true,enum:['list','inspect','save','run']},input_json:{type:'string',required:true}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    async execute(args){
      if(args.input_json.length>32768)return invalid('INPUT_LIMIT')
      const input:unknown=JSON.parse(args.input_json)
      if(!object(input))return invalid('INVALID_REQUEST')
      if(args.operation==='list'&&exact(input,[]))return JSON.stringify(await library.list())
      if(args.operation==='save'&&exact(input,['recipe','fixtures','expectedRevision'])&&typeof input.expectedRevision==='number'){
        const entry=await library.save(input.recipe,input.fixtures,input.expectedRevision)
        return JSON.stringify({id:entry.recipe.id,revision:entry.revision,fixturesPassed:entry.fixtureCount,persisted:true,kind:'numeric-recipe'})
      }
      if((args.operation==='inspect'||args.operation==='run')&&id(input.id)&&(input.revision===undefined||validRevision(input.revision))){
        const keys=['id',...(input.revision===undefined?[]:['revision']),...(args.operation==='run'?['values']:[])]
        if(!exact(input,keys))return invalid('INVALID_REQUEST')
        return JSON.stringify(args.operation==='inspect'?await library.get(input.id,input.revision):await library.execute(input.id,input.values,input.revision))
      }
      return invalid('INVALID_REQUEST')
    },
    presentCall:()=>({card:'generic',title:'PHOENIX · Biblioteca de herramientas propias',kind:'other' as const}),
  }))
}
