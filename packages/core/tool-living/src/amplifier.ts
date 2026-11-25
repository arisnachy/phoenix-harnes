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
    if(e.stance!=='supports'&&e.stance!=='opposes')throw Error('AMPLIFIER_STANCE')
    if(!claims.has(claim))claims.set(claim,new Set())
    if(observed>at){future.push(key);continue}
    if(expires<=at){expired.push(key);continue}
    const stances=claims.get(claim)??new Set<string>()
    stances.add(e.stance+':'+source);claims.set(claim,stances)
  }
  return {claims:[...claims].map(([claim,stances])=>{
    const supports=[...stances].filter(v=>v.startsWith('supports:')).length
    const opposes=[...stances].filter(v=>v.startsWith('opposes:')).length
    return {claim,supports,opposes,status:supports&&opposes?'contradicted':supports?'supported-by-supplied-evidence':opposes?'opposed-by-supplied-evidence':'no-current-evidence'}
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

/** Compile a numeric DAG to a reusable program. Every variable reference is
 * checked against its initial inputs or transitive dependency producers. */
function compileNumeric(raw:unknown){
  const x=obj(raw),inputs=uniqueIds(x.inputs)
  if(Object.keys(x).some(k=>k!=='inputs'&&k!=='steps'))throw Error('AMPLIFIER_RECIPE_FIELDS')
  const steps=list(x.steps,16).map(raw=>{
    const s=obj(raw)
    if(Object.keys(s).some(k=>!['id','dependsOn','output','expression'].includes(k)))throw Error('AMPLIFIER_RECIPE_FIELDS')
    return {id:id(s.id),dependsOn:uniqueIds(s.dependsOn),output:id(s.output),expression:s.expression}
  })
  if(!steps.length)throw Error('AMPLIFIER_RECIPE_EMPTY')
  const refs=(raw:unknown,out:Set<string>,budget:{remaining:number},depth=0):Expr=>{
    if(--budget.remaining<0||depth>16)throw Error('AMPLIFIER_EXPRESSION_LIMIT')
    if(typeof raw==='number')return num(raw)
    const e=obj(raw)
    if(Object.hasOwn(e,'var')){
      if(Object.keys(e).length!==1)throw Error('AMPLIFIER_EXPRESSION')
      const name=id(e.var);out.add(name);return {var:name}
    }
    if(Object.keys(e).length!==2||!['add','sub','mul','div','min','max'].includes(String(e.op)))throw Error('AMPLIFIER_OPERATOR')
    const args=list(e.args,2)
    if(args.length!==2)throw Error('AMPLIFIER_ARITY')
    return {op:e.op as 'add'|'sub'|'mul'|'div'|'min'|'max',args:args.map(a=>refs(a,out,budget,depth+1))}
  }
  const budget={remaining:512}
  const normalized=steps.map(s=>{
    if(inputs.includes(s.output))throw Error('AMPLIFIER_DUPLICATE_OUTPUT')
    const used=new Set<string>(),expr=refs(s.expression,used,budget)
    return {...s,expression:expr,requires:[...used].filter(v=>!inputs.includes(v)),produces:[s.output]}
  })
  const plan=compile(normalized)
  return {inputs,steps:plan.order.map(key=>{
    const s=normalized.find(v=>v.id===key)!
    return {id:s.id,dependsOn:s.dependsOn,output:s.output,expression:s.expression}
  })}
}
export function executeNumericRecipe(raw:unknown,initial:unknown){
  const program=compileNumeric(raw),values=variables(initial),budget={remaining:512}
  if(values.size!==program.inputs.length||program.inputs.some(k=>!values.has(k)))throw Error('AMPLIFIER_RECIPE_INPUTS')
  const results:Record<string,number>=Object.create(null) as Record<string,number>
  for(const step of program.steps){
    const value=expression(step.expression,values,budget)
    values.set(step.output,value);results[step.output]=value
  }
  return {results,order:program.steps.map(s=>s.id),deterministic:true,executionAuthorized:false}
}
/** Fixtures are caller supplied, not external validation or proof of generalization. */
export function verifyNumericRecipe(raw:unknown){
  const x=obj(raw),program=compileNumeric(x.program)
  if(Object.keys(x).some(k=>k!=='program'&&k!=='fixtures'))throw Error('AMPLIFIER_RECIPE_FIELDS')
  const fixtures=list(x.fixtures,8)
  if(fixtures.length<3)throw Error('AMPLIFIER_RECIPE_FIXTURES')
  const seen=new Set<string>()
  const normalized=fixtures.map(raw=>{
    const f=obj(raw),inputs=variables(f.inputs),expected=variables(f.expected)
    if(Object.keys(f).some(k=>k!=='inputs'&&k!=='expected'))throw Error('AMPLIFIER_RECIPE_FIELDS')
    const key=JSON.stringify([...inputs].sort(([a],[b])=>a.localeCompare(b)))
    if(seen.has(key))throw Error('AMPLIFIER_DUPLICATE_FIXTURE')
    seen.add(key)
    const result=executeNumericRecipe(program,Object.fromEntries(inputs)).results
    if(expected.size!==Object.keys(result).length||Object.keys(result).some(k=>expected.get(k)!==result[k]))throw Error('AMPLIFIER_RECIPE_FIXTURE_FAILED')
    return {inputs:Object.fromEntries(inputs),expected:Object.fromEntries(expected)}
  })
  return {program,fixtures:normalized,passed:normalized.length,verifiedInputs:false}
}
/** Find a bounded structure-preserving graph mapping, not a semantic analogy proof. */
function findAnalogy(x:Obj){
  const source=uniqueIds(x.source),target=uniqueIds(x.target)
  if(source.length>8||target.length>8||source.length>target.length||source.length===0)throw Error('AMPLIFIER_ANALOGY_LIMIT')
  const edgeList=(raw:unknown,nodes:string[])=>list(raw).map(v=>{
    const e=obj(v),from=id(e.from),to=id(e.to),relation=id(e.relation)
    if(!nodes.includes(from)||!nodes.includes(to))throw Error('AMPLIFIER_EDGE')
    return {from,to,relation}
  })
  const a=edgeList(x.sourceEdges,source),b=edgeList(x.targetEdges,target)
  if(!a.length)throw Error('AMPLIFIER_ANALOGY_NO_RELATIONS')
  const edges=new Set(b.map(e=>JSON.stringify([e.from,e.to,e.relation])))
  const mapping=new Map<string,string>(),used=new Set<string>()
  let best:{source:string;target:string}[]=[],score=-1,explored=0
  const visit=(i:number)=>{
    if(i===source.length){
      explored++
      const matched=a.filter(e=>edges.has(JSON.stringify([mapping.get(e.from),mapping.get(e.to),e.relation]))).length
      if(matched>score){score=matched;best=[...mapping].map(([source,target])=>({source,target}))}
      return
    }
    const key=source[i]!
    for(const t of target){if(used.has(t))continue;mapping.set(key,t);used.add(t);visit(i+1);mapping.delete(key);used.delete(t)}
  }
  visit(0)
  return {mapping:best,preserved:score,total:a.length,explored,analogyProven:false}
}
function gradePractice(x:Obj){
  const skills=uniqueIds(x.skills),seen=new Set<string>()
  const attempts=list(x.exercises).map(raw=>{
    const e=obj(raw),skill=id(e.skill),exercise=id(e.id)
    if(!skills.includes(skill)||seen.has(exercise))throw Error('AMPLIFIER_ATTEMPT')
    seen.add(exercise)
    if(typeof e.expected!=='number'||typeof e.answer!=='number')throw Error('AMPLIFIER_NUMBER')
    return {skill,exercise,correct:num(e.expected)===num(e.answer)}
  })
  const assessment=mentor({skills,attempts})
  return {...assessment,attempts,practiceNext:assessment.skills.filter(s=>s.status!=='practice-transfer').map(s=>s.skill),answerKeysVerified:false}
}
function checkSegments(x:Obj){
  const segments=list(x.segments,32),seen=new Set<string>()
  const glossary=list(x.glossary,32).map(raw=>{
    const g=obj(raw);return {source:text(g.source,160).normalize('NFC'),target:text(g.target,160).normalize('NFC')}
  })
  const tokenPattern=/\{\{[\w.-]+\}\}|\{[\w.-]+\}|%[sdif]|\$\{[\w.-]+\}/gu
  const results=segments.map(raw=>{
    const s=obj(raw),key=id(s.id),original=text(s.source,4000).normalize('NFC'),translated=text(s.translation,4000).normalize('NFC')
    if(seen.has(key))throw Error('AMPLIFIER_DUPLICATE');seen.add(key)
    const tokens=(v:string)=>(v.match(tokenPattern)??[]).sort()
    const placeholdersPreserved=JSON.stringify(tokens(original))===JSON.stringify(tokens(translated))
    const missing=glossary.filter(g=>original.includes(g.source)&&!translated.includes(g.target)).map(g=>g.target)
    return {id:key,placeholdersPreserved,missing,valid:placeholdersPreserved&&!missing.length}
  })
  return {segments:results,valid:results.every(s=>s.valid),semanticEquivalenceVerified:false}
}

export const AMPLIFIER_OPERATIONS=['logos','compression','compile','epistemic','counterfactual','analogy','mentor','babel','sentinel','morphogenesis','compile-run','recipe-test','analogy-find','mentor-grade','babel-segments'] as const
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
    case 'compile-run':return executeNumericRecipe(x.program,x.inputs)
    case 'recipe-test':return verifyNumericRecipe(x)
    case 'analogy-find':return findAnalogy(x)
    case 'mentor-grade':return gradePractice(x)
    case 'babel-segments':return checkSegments(x)
    default:throw Error('AMPLIFIER_OPERATION')
  }
}
