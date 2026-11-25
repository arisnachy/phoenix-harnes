/** Provider-neutral bounded deterministic reasoning. No eval, network, disk,
 * background workers, secret access, authority grants or automatic execution. */
type Obj=Record<string,unknown>
const LIMIT=64
const ID=/^[a-z][a-z0-9_.-]{0,63}$/u
function obj(v:unknown):Obj{
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error('AMPLIFIER_OBJECT')
  return v as Obj
}
function id(v:unknown):string{
  if(typeof v!=='string'||!ID.test(v))throw Error('AMPLIFIER_ID')
  return v
}
function list(v:unknown,max=LIMIT):unknown[]{
  if(!Array.isArray(v)||v.length>max)throw Error('AMPLIFIER_LIMIT')
  return v
}
function num(v:unknown):number{
  if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12)throw Error('AMPLIFIER_NUMBER')
  return v
}
function text(v:unknown,max=256):string{
  if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('AMPLIFIER_TEXT')
  return v
}
function uniqueIds(raw:unknown):string[]{
  const values=list(raw).map(id)
  if(new Set(values).size!==values.length)throw Error('AMPLIFIER_DUPLICATE')
  return values
}
type Expr=number|{var:string}|{op:'add'|'sub'|'mul'|'div'|'min'|'max';args:Expr[]}
function expression(raw:unknown,variables:Map<string,number>,budget:{remaining:number},depth=0):number{
  if(--budget.remaining<0||depth>16)throw Error('AMPLIFIER_EXPRESSION_LIMIT')
  if(typeof raw==='number')return num(raw)
  const x=obj(raw)
  if(Object.hasOwn(x,'var')){
    if(Object.keys(x).length!==1)throw Error('AMPLIFIER_EXPRESSION')
    const value=variables.get(id(x.var))
    if(value===undefined)throw Error('AMPLIFIER_UNKNOWN_VARIABLE')
    return value
  }
  if(Object.keys(x).length!==2)throw Error('AMPLIFIER_EXPRESSION')
  const args=list(x.args,2)
  if(args.length!==2)throw Error('AMPLIFIER_ARITY')
  const a=expression(args[0],variables,budget,depth+1),b=expression(args[1],variables,budget,depth+1)
  switch(x.op){
    case 'add':return num(a+b)
    case 'sub':return num(a-b)
    case 'mul':return num(a*b)
    case 'div':if(b===0)throw Error('AMPLIFIER_DIV_ZERO');return num(a/b)
    case 'min':return Math.min(a,b)
    case 'max':return Math.max(a,b)
    default:throw Error('AMPLIFIER_OPERATOR')
  }
}
function variables(raw:unknown):Map<string,number>{
  const entries=Object.entries(obj(raw))
  if(entries.length>LIMIT)throw Error('AMPLIFIER_LIMIT')
  return new Map(entries.map(([k,v])=>[id(k),num(v)]))
}
function compare(a:number,b:number,op:unknown):boolean{
  switch(op){case 'eq':return a===b;case 'lt':return a<b;case 'le':return a<=b;case 'gt':return a>b;case 'ge':return a>=b;default:throw Error('AMPLIFIER_COMPARISON')}
}
/** Validate a dependency DAG and derive a stable execution order. */
function compile(raw:unknown){
  const rows=list(raw).map(v=>{
    const x=obj(v)
    return {id:id(x.id),dependsOn:uniqueIds(x.dependsOn),requires:uniqueIds(x.requires??[]),produces:uniqueIds(x.produces??[])}
  })
  const byId=new Map(rows.map(x=>[x.id,x]))
  if(byId.size!==rows.length)throw Error('AMPLIFIER_DUPLICATE')
  const order:string[]=[],done=new Set<string>(),visiting=new Set<string>()
  const visit=(key:string)=>{
    if(done.has(key))return
    if(visiting.has(key))throw Error('AMPLIFIER_CYCLE')
    const node=byId.get(key)
    if(!node)throw Error('AMPLIFIER_UNKNOWN_DEPENDENCY')
    visiting.add(key);node.dependsOn.forEach(visit);visiting.delete(key);done.add(key);order.push(key)
  }
  rows.forEach(x=>visit(x.id))
  const ancestorOutputs=new Map<string,Set<string>>()
  const produced=new Set<string>()
  for(const key of order){
    const node=byId.get(key)!
    const available=new Set(node.dependsOn.flatMap(dep=>[...ancestorOutputs.get(dep)!]))
    if(node.requires.some(k=>!available.has(k)))throw Error('AMPLIFIER_UNSATISFIED_INPUT')
    for(const k of node.produces){if(produced.has(k))throw Error('AMPLIFIER_DUPLICATE_OUTPUT');produced.add(k);available.add(k)}
    ancestorOutputs.set(key,available)
  }
  return {order,steps:rows.length,valid:true,executionAuthorized:false}
}
function logos(x:Obj){
  const vars=variables(x.variables),budget={remaining:512}
  const value=expression(x.expression,vars,budget)
  const checks=list(x.constraints??[]).map(raw=>{
    const c=obj(raw)
    return compare(value,num(c.value),c.op)
  })
  return {value,checks,valid:checks.every(Boolean),numericSemantics:'IEEE-754',verifiedInputs:false}
}
function compression(x:Obj){
  // A small typed expression recipe, not generated executable source.
  const steps=list(x.steps,16).map(raw=>{const s=obj(raw);return {output:id(s.output),expression:s.expression as Expr}})
  const vars=variables(x.variables),budget={remaining:512}
  const results:Record<string,number>=Object.create(null) as Record<string,number>
  for(const step of steps){
    if(vars.has(step.output))throw Error('AMPLIFIER_DUPLICATE_OUTPUT')
    const value=expression(step.expression,vars,budget);vars.set(step.output,value);results[step.output]=value
  }
  return {results,steps:steps.length,deterministic:true,installed:false,verifiedInputs:false}
}
function epistemic(x:Obj){
  const timestamp=(v:unknown):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>8.64e15)throw Error('AMPLIFIER_TIMESTAMP');return v}
  const at=timestamp(x.at)
  const seen=new Set<string>()
  const claims=new Map<string,Set<string>>()
  const expired:string[]=[],future:string[]=[]
  for(const raw of list(x.evidence)){
    const e=obj(raw),key=id(e.id),claim=id(e.claim),source=id(e.source),observed=timestamp(e.observed),expires=timestamp(e.expires)
    if(seen.has(key)||expires<observed)throw Error('AMPLIFIER_EVIDENCE')
    seen.add(key)
    if(observed>at){future.push(key);continue}
    if(expires<=at){expired.push(key);continue}
    if(e.stance!=='supports'&&e.stance!=='opposes')throw Error('AMPLIFIER_STANCE')
    const stances=claims.get(claim)??new Set<string>()
    stances.add(e.stance+':'+source);claims.set(claim,stances)
  }
  return {claims:[...claims].map(([claim,stances])=>{
    const supports=[...stances].filter(v=>v.startsWith('supports:')).length
    const opposes=[...stances].filter(v=>v.startsWith('opposes:')).length
    return {claim,supports,opposes,status:supports&&opposes?'contradicted':supports?'supported-by-supplied-evidence':'opposed-by-supplied-evidence'}
  }),expired,future,verifiedSources:false,probability:null}
}
function counterfactual(x:Obj){
  const baseline=variables(x.baseline),changed=new Map(baseline),interventions=variables(x.interventions)
  for(const [key,value] of interventions){if(!baseline.has(key))throw Error('AMPLIFIER_UNKNOWN_INTERVENTION');changed.set(key,value)}
  const budget={remaining:512},outputs=new Set<string>()
  for(const raw of list(x.equations,16)){
    const e=obj(raw),key=id(e.output)
    if(baseline.has(key)||outputs.has(key))throw Error('AMPLIFIER_DUPLICATE_OUTPUT')
    outputs.add(key)
    baseline.set(key,expression(e.expression,baseline,budget))
    changed.set(key,expression(e.expression,changed,budget))
  }
  const outcome=id(x.outcome)
  const before=baseline.get(outcome),after=changed.get(outcome)
  if(before===undefined||after===undefined)throw Error('AMPLIFIER_UNKNOWN_OUTCOME')
  return {baseline:before,intervention:after,difference:num(after-before),assumptions:'caller-defined deterministic structural equations; order must be causal',causalProof:false}
}
function analogy(x:Obj){
  const source=uniqueIds(x.source),target=uniqueIds(x.target)
  const mapped=new Map<string,string>(),used=new Set<string>()
  for(const raw of list(x.mapping)){
    const m=obj(raw),a=id(m.source),b=id(m.target)
    if(!source.includes(a)||!target.includes(b)||mapped.has(a)||used.has(b))throw Error('AMPLIFIER_MAPPING')
    mapped.set(a,b);used.add(b)
  }
  const edges=(raw:unknown,nodes:string[])=>list(raw).map(v=>{
    const e=obj(v),a=id(e.from),b=id(e.to),relation=id(e.relation)
    if(!nodes.includes(a)||!nodes.includes(b))throw Error('AMPLIFIER_EDGE')
    return {a,b,relation}
  })
  const targetEdges=edges(x.targetEdges,target)
  const matched=edges(x.sourceEdges,source).map(e=>({from:e.a,to:e.b,relation:e.relation,preserved:targetEdges.some(t=>t.a===mapped.get(e.a)&&t.b===mapped.get(e.b)&&t.relation===e.relation)}))
  return {matched,unmapped:source.filter(k=>!mapped.has(k)),analogyProven:false}
}
function mentor(x:Obj){
  const skills=uniqueIds(x.skills),results=new Map<string,Map<string,boolean>>()
  for(const raw of list(x.attempts)){
    const a=obj(raw),skill=id(a.skill),exercise=id(a.exercise)
    if(!skills.includes(skill)||typeof a.correct!=='boolean')throw Error('AMPLIFIER_ATTEMPT')
    const seen=results.get(skill)??new Map<string,boolean>()
    // Multiple submissions of the same exercise are not independent evidence.
    seen.set(exercise,a.correct);results.set(skill,seen)
  }
  return {skills:skills.map(skill=>{
    const scores=[...(results.get(skill)?.values()??[])],correct=scores.filter(Boolean).length
    return {skill,attempts:scores.length,correct,status:scores.length<3?'insufficient-evidence':correct===scores.length?'practice-transfer':'review-and-practice'}
  }),masteryCertified:false}
}
function babel(x:Obj){
  const translated=text(x.translation,12000)
  const missing=list(x.glossary,32).map(raw=>{
    const t=obj(raw),term=text(t.target,160)
    return {term,present:translated.normalize('NFC').includes(term.normalize('NFC'))}
  }).filter(t=>!t.present).map(t=>t.term)
  const expected=list(x.placeholders,64).map(v=>text(v,80))
  const counts=expected.map(token=>({token,count:translated.split(token).length-1}))
  return {missingTerms:missing,placeholderCounts:counts,valid:missing.length===0&&counts.every(t=>t.count===1),semanticEquivalenceVerified:false}
}
function sentinel(x:Obj){
  if(x.origin!=='user'&&x.origin!=='external'&&x.origin!=='tool')throw Error('AMPLIFIER_ORIGIN')
  if(x.effect!=='read'&&x.effect!=='write'&&x.effect!=='external'&&x.effect!=='permission')throw Error('AMPLIFIER_EFFECT')
  // Advisory only: cannot override runtime authorization or detect arbitrary injections.
  const reasons:string[]=[]
  if(x.origin!=='user'&&x.effect!=='read')reasons.push('untrusted-origin-side-effect')
  if(x.effect==='permission')reasons.push('permission-change-requires-native-approval')
  if(x.effect==='external')reasons.push('external-transfer-requires-native-approval')
  if(x.effect==='write'&&x.revisionVerified!==true)reasons.push('unverified-revision')
  return {status:reasons.length?'review-required':'no-listed-conflict',reasons,executionAuthorized:false}
}
function morphology(x:Obj){
  const before=uniqueIds(x.before),after=uniqueIds(x.after)
  const removed=before.filter(v=>!after.includes(v)),added=after.filter(v=>!before.includes(v))
  const preserved=uniqueIds(x.preserved)
  if(preserved.some(v=>!before.includes(v)||!after.includes(v)))throw Error('AMPLIFIER_MIGRATION')
  const risk=removed.length>0||before.some(v=>after.includes(v)&&!preserved.includes(v))
  return {added,removed,preserved,requiresBackup:risk,requiresMigrationTest:true,executionAuthorized:false}
}
export const AMPLIFIER_OPERATIONS=['logos','compression','compile','epistemic','counterfactual','analogy','mentor','babel','sentinel','morphogenesis'] as const
/** Parse only bounded explicit structured proposals. No raw transcripts. */
export function runAmplifier(operation:string,raw:string):unknown{
  if(Buffer.byteLength(raw,'utf8')>32768)throw Error('AMPLIFIER_LIMIT')
  const x=obj(JSON.parse(raw))
  switch(operation){
    case 'logos':return logos(x)
    case 'compression':return compression(x)
    case 'compile':return compile(x.steps)
    case 'epistemic':return epistemic(x)
    case 'counterfactual':return counterfactual(x)
    case 'analogy':return analogy(x)
    case 'mentor':return mentor(x)
    case 'babel':return babel(x)
    case 'sentinel':return sentinel(x)
    case 'morphogenesis':return morphology(x)
    default:throw Error('AMPLIFIER_OPERATION')
  }
}
