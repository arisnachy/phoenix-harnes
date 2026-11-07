#!/usr/bin/env node
/** PHOENIX research-only adapters for executable vascular/electrophysiology engines.
 * Every run requires a clinician-prepared configuration. No ECG, GLB or
 * segmentation is silently converted into solver geometry or boundary conditions.
 */
import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync,statSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve,join,extname,dirname,isAbsolute} from 'node:path'
import {homedir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {rootFor} from './phoenix-anatomy-auto.mjs'

const name=fileURLToPath(import.meta.url)
const supported=['svzerod','opencarp','simvascular']
const flags=process.argv.slice(2)
const has=k=>flags.includes(k)
const arg=k=>flags.includes(k)?flags[flags.indexOf(k)+1]:undefined
const wslDistro=()=>process.env.PHOENIX_ANATOMY_WSL_DISTRO||'Ubuntu-24.04'
const minTime=1000,maxTime=45*60*1000
const timeLimit=()=>Math.min(maxTime,Math.max(minTime,Number(arg('--timeout-ms')||900000)||900000))
const dataHome=()=>resolve(process.env.PHOENIX_ANATOMY_HOME||rootFor())
const binary=(engine)=>{
 if(engine==='svzerod'){
  const fromEnv=process.env.PHOENIX_SVZEROD_BIN
  const defaultBin=join(dataHome(),'.venv',process.platform==='win32'?'Scripts':'bin',
    process.platform==='win32'?'svzerodsolver.exe':'svzerodsolver')
  if(fromEnv&&isAbsolute(fromEnv)&&existsSync(fromEnv))return fromEnv
  return existsSync(defaultBin)?defaultBin:null
 }
 if(engine==='opencarp'){
  if(process.platform==='win32')return 'openCARP'
  const fromEnv=process.env.PHOENIX_OPENCARP_BIN
  return fromEnv&&isAbsolute(fromEnv)&&existsSync(fromEnv)?fromEnv:'openCARP'
 }
 if(engine==='simvascular'){
  const fromEnv=process.env.PHOENIX_SIMVASCULAR_BIN
  if(!fromEnv)return null
  if(process.platform==='win32'){
   // WSL runs a vetted path under SimVascular's official install tree.
   return /^\/usr\/local\/sv\/simvascular\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/simvascular$/.test(fromEnv)?fromEnv:null
  }
  return isAbsolute(fromEnv)&&existsSync(fromEnv)?fromEnv:null
 }
 return null
}
function invalid(reason){throw Error(reason)}
export function allowedEngine(engine){return supported.includes(engine)}
export function validateInput(engine,input,output){
 if(!allowedEngine(engine))invalid('Unsupported simulation engine')
 if(!input||!output)invalid('Both input and output are required')
 const source=resolve(input),target=resolve(output)
 if(!existsSync(source)||!statSync(source).isFile())invalid('Configuration file does not exist')
 const extension=extname(source).toLowerCase()
 if((engine==='svzerod'&&extension!=='.json')||(engine==='opencarp'&&extension!=='.par'))
  invalid('Engine requires a matching .json or .par configuration')
 if(engine==='simvascular')invalid('Use launch, not run, to open the SimVascular GUI')
 if(source===target||target.startsWith(source+'/')||target.startsWith(source+'\\'))
  invalid('Output must be distinct from input')
 if(statSync(source).size>5*1024*1024||statSync(source).size<5)invalid('Configuration size outside permitted range')
 if(engine==='svzerod'){
  const data=JSON.parse(readFileSync(source,'utf8'))
  if(data===null||typeof data!=='object'||Array.isArray(data))invalid('Invalid vascular network JSON')
 }
 if(engine==='opencarp'&&readFileSync(source,'utf8').trim()==='')invalid('Empty openCARP parameter file')
 return {source,target}
}
export function buildInvocation(engine,config,output,platform=process.platform,env=process.env){
 if(!allowedEngine(engine))invalid('Unsupported simulation engine')
 const wsl=platform==='win32'
 if(engine==='simvascular'){
  const b=env.PHOENIX_SIMVASCULAR_BIN
  if(wsl&&!/^\/usr\/local\/sv\/simvascular\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/simvascular$/.test(b||''))
   invalid('Verified SimVascular WSL binary path is required')
  if(!wsl&&(!b||!isAbsolute(b)))invalid('Verified SimVascular binary is required')
  return wsl?{cmd:'wsl.exe',args:['--distribution',env.PHOENIX_ANATOMY_WSL_DISTRO||'Ubuntu-24.04','--exec',b]}:{cmd:b,args:[]}
 }
 if(engine==='opencarp'){
  const b=wsl?'openCARP':env.PHOENIX_OPENCARP_BIN||'openCARP'
  return wsl?{cmd:'wsl.exe',args:['--distribution',env.PHOENIX_ANATOMY_WSL_DISTRO||'Ubuntu-24.04',
   '--exec',b,'-par',config,'-simID',output]}:
   {cmd:b,args:['-par',config,'-simID',output]}
 }
 if(wsl){
  const b=env.PHOENIX_SVZEROD_BIN
  if(!b||!isAbsolute(b))invalid('svZeroDSolver executable path must be configured on Windows')
  return {cmd:b,args:[config,output]}
 }
 return {cmd:env.PHOENIX_SVZEROD_BIN||'svzerodsolver',args:[config,output]}
}
export async function execute(invocation,{timeoutMs=900000,limit=8192}={}){
 if(timeoutMs<minTime||timeoutMs>maxTime)invalid('Timeout outside allowed range')
 return await new Promise((yes,no)=>{
  let ended=false,output='',errorText=''
  const child=spawn(invocation.cmd,invocation.args,{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']})
  const finish=(err,result)=>{
   if(ended)return
   ended=true;clearTimeout(timer)
   if(err)no(err);else yes(result)
  }
  const timer=setTimeout(()=>{child.kill();finish(Error('Simulation timed out'))},timeoutMs)
  child.stdout.on('data',data=>{output=(output+String(data)).slice(-limit)})
  child.stderr.on('data',data=>{errorText=(errorText+String(data)).slice(-limit)})
  child.on('error',err=>finish(err))
  child.on('close',code=>finish(null,{exitCode:code??1,stdout:output,stderr:errorText}))
 })
}
async function toWsl(path){
 const r=await execute({cmd:'wsl.exe',args:['--distribution',wslDistro(),'--exec','wslpath','-a',path]},{timeoutMs:12000})
 const w=r.stdout.trim()
 if(r.exitCode!==0||!w.startsWith('/')||w.includes('\n'))invalid('WSL file path conversion unavailable')
 return w
}
export async function doctor(){
 const results={}
 for(const engine of supported){
  const b=binary(engine)
  if(engine==='svzerod'){
   if(b){
    try{
     const r=await execute({cmd:b,args:[]},{timeoutMs:12000})
     // The solver's CLI may exit nonzero for missing input, but was actually invoked.
     results[engine]={status:'executable-detected',exitCode:r.exitCode}
    }catch{results[engine]={status:'not-executable'}}
   }else results[engine]={status:'not-installed',help:'Install svzerod==3.2 in PHOENIX anatomy venv'}
  }else if(engine==='opencarp'){
   try{
    const invocation=process.platform==='win32'?{cmd:'wsl.exe',args:['--distribution',wslDistro(),'--exec','openCARP','-buildinfo']}:
      {cmd:b,args:['-buildinfo']}
    const r=await execute(invocation,{timeoutMs:18000})
    results[engine]={status:r.exitCode===0?'ready':'unverified',buildInfoChecked:r.exitCode===0}
   }catch{results[engine]={status:'not-installed',help:'Install openCARP in WSL2 or Linux and verify openCARP -buildinfo'}}
  }else{
   results[engine]={status:b?'configured-not-launched':'not-configured',
    help:'Install supported SimVascular build under WSL Ubuntu 24.04 and set PHOENIX_SIMVASCULAR_BIN'}
  }
 }
 return {systems:results,patientDataRead:false,clinicalValidation:'not-validated',wslDistro:wslDistro()}
}
export async function runSimulation({engine,input,output,timeoutMs=900000,researchOnly=false}){
 if(!researchOnly)invalid('Explicit --research-only required')
 if(engine==='simvascular')invalid('Use launch for SimVascular GUI; cannot assume CFD inputs from GLB')
 const {source,target}=validateInput(engine,input,output)
 if(existsSync(target))invalid('Refusing to overwrite existing simulation output')
 mkdirSync(dirname(target),{recursive:true})
 const chosen=binary(engine)
 if(engine==='svzerod'&&!chosen)invalid('svZeroDSolver executable not installed')
 const c=process.platform==='win32'&&engine==='opencarp'?await toWsl(source):source
 const o=process.platform==='win32'&&engine==='opencarp'?await toWsl(target):target
 const inv=buildInvocation(engine,c,o,process.platform,{
  ...process.env,PHOENIX_SVZEROD_BIN:chosen||process.env.PHOENIX_SVZEROD_BIN,
 })
 const result=await execute(inv,{timeoutMs})
 const succeeded=result.exitCode===0&&existsSync(target)
 const sha=createHash('sha256').update(readFileSync(source)).digest('hex')
 const receipt={engine,status:succeeded?'completed-research-only':'execution-failed',exitCode:result.exitCode,
  inputSha256:sha,outputPresent:existsSync(target),clinicalValidation:'not-validated',
  medicalReviewRequired:true,notes:'Solver output is not a medical finding; requires verified mesh, physics, boundary conditions and clinical review.'}
 const receiptPath=target+'.phoenix-receipt.json'
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600})
 return {receipt,receiptPath}
}
export async function launchSimVascular(){
 const b=binary('simvascular')
 if(!b)invalid('SimVascular not configured; native Windows build is not supported')
 const invocation=buildInvocation('simvascular','','',process.platform,process.env)
 const r=await execute(invocation,{timeoutMs:10000})
 return {status:r.exitCode===0?'exited':'launch-attempted',exitCode:r.exitCode,clinicalValidation:'not-validated'}
}
async function main(){
 const command=flags[0]||'doctor'
 if(command==='doctor')return console.log(JSON.stringify(await doctor(),null,2))
 if(command==='launch'&&arg('--engine')==='simvascular')
  return console.log(JSON.stringify(await launchSimVascular(),null,2))
 if(command==='run'){
  const engine=arg('--engine')
  if(!allowedEngine(engine))invalid('Supply --engine svzerod or opencarp')
  const out=await runSimulation({engine,input:arg('--input'),output:arg('--output'),
   timeoutMs:timeLimit(),researchOnly:has('--research-only')})
  console.log(JSON.stringify(out,null,2));if(out.receipt.exitCode!==0)process.exitCode=2;return
 }
 invalid('Usage: doctor | run --engine svzerod|opencarp --input config --output result --research-only | launch --engine simvascular')
}
if(process.argv[1]&&resolve(process.argv[1])===name)
 main().catch(e=>{console.error(JSON.stringify({status:'error',message:e.message,clinicallyValidated:false}));process.exitCode=2})
