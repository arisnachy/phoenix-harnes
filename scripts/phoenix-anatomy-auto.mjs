#!/usr/bin/env node
/**
 * Optional PHOENIX anatomy dependency bootstrap. No patient data, no privileged
 * privileged system modifications. Preloads an open CT model when resources allow.
 * Can run detached on update and directly with --install for diagnostics.
 * Installed libraries are NOT a validated diagnostic imaging pipeline.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, rmSync, statSync, statfsSync, appendFileSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCHEMA = 2
const self=fileURLToPath(import.meta.url)
export const rootFor=(env=process.env)=>resolve(env.PHOENIX_ANATOMY_HOME ||
  join(env.LOCALAPPDATA||homedir(),env.LOCALAPPDATA?'PHOENIX':'.phoenix','anatomy'))
const pathsFor=(env=process.env)=>{
  const root=rootFor(env)
  const bin=process.platform==='win32'?'Scripts':'bin'
  const exe=process.platform==='win32'?'python.exe':'python'
  return {root,venv:join(root,'.venv'),python:join(root,'.venv',bin,exe),
    manifest:join(root,'manifest.json'),lock:join(root,'install.lock'),log:join(root,'install.log')}
}
const modules=[
  {id:'dicom',imports:['pydicom','SimpleITK','nibabel'],pip:['pydicom>=3,<4','SimpleITK>=2.4,<3','nibabel>=5,<6']},
  {id:'volume3d',imports:['vtk'],pip:['vtk>=9.3,<10']},
  {id:'meshes',imports:['trimesh','skimage'],pip:['trimesh>=4,<6','scikit-image>=0.24,<1']},
  {id:'monai',imports:['monai'],pip:['monai>=1.4,<2']},
  {id:'svzerod',imports:['svzerod'],pip:['svzerod==3.2']},
  {id:'nnunetv2',imports:['nnunetv2'],pip:['nnunetv2>=2,<3']},
  {id:'totalsegmentator',imports:['totalsegmentator'],pip:['TotalSegmentator>=2,<3']},
]
const now=()=>new Date().toISOString()
const BASELINE_TASK='total'
export const weightsRoot=(env=process.env)=>resolve(env.TOTALSEG_HOME_DIR||join(rootFor(env),'models'))
const modelEnv=(env=process.env)=>({...env,
  TOTALSEG_HOME_DIR:env.TOTALSEG_HOME_DIR||weightsRoot(env)})
const log=(p,line)=>{try{appendFileSync(p.log,'['+now()+'] '+line+'\n')}catch{}}
function load(p){
  try{const x=JSON.parse(readFileSync(p.manifest,'utf8'));return x.schema===SCHEMA?x:null}catch{return null}
}
function save(p,state){
  mkdirSync(p.root,{recursive:true})
  const tmp=p.manifest+'.partial'
  writeFileSync(tmp,JSON.stringify({...state,schema:SCHEMA,updatedAt:now()},null,2)+'\n')
  renameSync(tmp,p.manifest)
}
export function needsInstall(manifest,at=Date.now()){
  if(!manifest||manifest.schema!==SCHEMA)return true
  if(modules.every(x=>manifest.components?.[x.id]?.status==='installed') &&
    manifest.components?.slicer?.status==='installed' &&
    manifest.components?.slicerheart?.status==='installed' &&
    manifest.components?.viewer?.status==='installed' &&
    ['installed','disabled'].includes(manifest.components?.weights_ct?.status))return false
  const stamp=Date.parse(manifest.updatedAt||'')
  return !Number.isFinite(stamp)||at-stamp>24*60*60*1000
}
async function run(bin,args,{cwd,timeout=900000,output,env}={}){
  return new Promise((resolveRun,reject)=>{
    let finished=false
    const child=spawn(bin,args,{cwd,windowsHide:true,shell:false,env:env??process.env,
      stdio:['ignore',output??'ignore',output??'ignore']})
    const timer=setTimeout(()=>{child.kill();if(!finished){finished=true;reject(Error('Timeout: '+bin))}},timeout)
    child.once('error',e=>{if(!finished){finished=true;clearTimeout(timer);reject(e)}})
    child.once('close',code=>{if(!finished){finished=true;clearTimeout(timer);code===0?resolveRun(0):reject(Error(bin+' exited '+code))}})
  })
}
async function pythonCommand(){
  const candidates=process.platform==='win32'
    ?[['py',['-3.12']],['py',['-3.11']],['py',['-3.13']],['python',[]]]
    :[['python3.12',[]],['python3.11',[]],['python3',[]],['python',[]]]
  for(const [bin,args] of candidates){
    try{await run(bin,[...args,'-c','import sys; assert (3,11)<=sys.version_info[:2]<(3,14)'],{timeout:12000});return [bin,args]}catch{}
  }
  if(process.platform==='win32'&&process.env.PHOENIX_ANATOMY_AUTO_PYTHON!=='0'){
    try{await run('winget',['install','--id','Python.Python.3.12','--exact','--scope','user',
      '--silent','--accept-package-agreements','--accept-source-agreements','--disable-interactivity'],{timeout:360000})}catch{}
    for(const [bin,args] of candidates.slice(0,1)){
      try{await run(bin,[...args,'-c','import sys;assert sys.version_info[:2]>=(3,12)'],{timeout:12000});return [bin,args]}catch{}
    }
  }
  throw Error('Python 3.11-3.13 not found; automated user-scoped Python setup unavailable')
}
async function checkImports(p,names){
  if(!existsSync(p.python))return false
  try{await run(p.python,['-c','import importlib.util,sys;sys.exit(int(not all(importlib.util.find_spec(n) for n in '+JSON.stringify(names)+')))'],{timeout:20000});return true}catch{return false}
}
async function prepareVenv(p){
  if(await checkImports(p,['pip']))return
  const [bin,args]=await pythonCommand()
  await run(bin,[...args,'-m','venv',p.venv],{timeout:180000})
  if(!await checkImports(p,['pip']))throw Error('Isolated Python venv incomplete')
}
function freeBytes(p){try{const s=statfsSync(p.root);return Number(s.bavail)*Number(s.bsize)}catch{return 0}}
async function installPythonComponents(p,state,fd){
  await prepareVenv(p)
  for(const component of modules){
    // Always verify packages; a stale manifest cannot prove installation.
    if(await checkImports(p,component.imports)){
      state.components[component.id]={status:'installed',verifiedAt:now()}
      save(p,state);continue
    }
    if(component.id!=='dicom'&&freeBytes(p)<12e9){
      state.components[component.id]={status:'deferred',reason:'less than 12 GB available'}
      save(p,state);continue
    }
    state.components[component.id]={status:'installing'};save(p,state)
    try{
      if(!await checkImports(p,component.imports)){
        await run(p.python,['-m','pip','install','--disable-pip-version-check','--prefer-binary',...component.pip],
          {cwd:p.root,timeout:1800000,output:fd})
      }
      if(!await checkImports(p,component.imports))throw Error('Import verification failed')
      state.components[component.id]={status:'installed',verifiedAt:now()}
    }catch(e){state.components[component.id]={status:'error',reason:String(e).slice(0,250)};log(p,component.id+': '+String(e))}
    save(p,state)
  }
}

/** Download only the open baseline CT task. Vendor-licensed tasks are excluded. */
async function installBaselineWeights(p,state,fd,env=process.env){
  if(env.PHOENIX_ANATOMY_PRELOAD_WEIGHTS==='0'){
    state.components.weights_ct={status:'disabled',reason:'Operator opted out'}
    save(p,state);return
  }
  if(state.components.totalsegmentator?.status!=='installed'){
    state.components.weights_ct={status:'deferred',reason:'Install TotalSegmentator first'}
    save(p,state);return
  }
  const command=join(p.venv,process.platform==='win32'?'Scripts':'bin',
    process.platform==='win32'?'totalseg_download_weights.exe':'totalseg_download_weights')
  if(!existsSync(command)){
    state.components.weights_ct={status:'error',reason:'Official totalseg_download_weights executable missing'}
    save(p,state);return
  }
  const root=weightsRoot(env),results=join(root,'nnunet','results')
  if(state.components.weights_ct?.status==='installed'&&existsSync(results)&&readdirSync(results).length){
    state.components.weights_ct.verifiedAt=now()
    save(p,state);return
  }
  if(freeBytes(p)<12e9){
    state.components.weights_ct={status:'deferred',reason:'Less than 12 GB free; skipping model download'}
    save(p,state);return
  }
  mkdirSync(root,{recursive:true,mode:0o700})
  state.components.weights_ct={status:'installing',task:BASELINE_TASK};save(p,state)
  try{
    await run(command,['-t',BASELINE_TASK],{cwd:p.root,output:fd,
      env:modelEnv(env),timeout:1800000})
    if(!existsSync(results)||!readdirSync(results).length)
      throw Error('Downloader succeeded but no model files were found')
    state.components.weights_ct={status:'installed',task:BASELINE_TASK,
      location:results,licensed:false,verifiedAt:now()}
    log(p,'Open baseline CT weights downloaded to '+results)
  }catch(e){
    state.components.weights_ct={status:'error',task:BASELINE_TASK,
      reason:String(e).slice(0,250)}
    log(p,'weights_ct: '+String(e))
  }
  save(p,state)
}
function findSlicer(){
  if(process.platform!=='win32')return null
  const local=process.env.LOCALAPPDATA
  if(!local)return null
  for(const base of [join(local,'NA-MIC'),join(local,'Programs')]){
    try{
      const folders=readdirSync(base,{withFileTypes:true})
      for(const entry of folders){
        if(!entry.isDirectory()||!/^Slicer(?:[ ._-]|\d|$)/i.test(entry.name))continue
        const path=join(base,entry.name,'Slicer.exe')
        if(existsSync(path))return path
      }
    }catch{}
  }
  return null
}

async function installSlicer(p,state,fd){
  if(process.platform!=='win32'){
    state.components.slicer={status:'external',reason:'Windows installer only; use official platform package'}
    return
  }
  // Use the vendor's user-scoped installer; it validates the Slicer payload SHA512.
  // No arbitrary URLs, forced admin elevation, downloads of patient data or model weights.
  const existing=findSlicer()
  if(existing){
    state.components.slicer={status:'installed',verifiedAt:now(),executable:existing}
    return
  }
  try{
    const cmd="& { $ErrorActionPreference='Stop'; "+
      "$u='https://download.slicer.org/install.ps1';"+
      "$p=Join-Path $env:TEMP 'phoenix-slicer-official-install.ps1';"+
      "Invoke-WebRequest -Uri $u -OutFile $p -UseBasicParsing;"+
      "$env:SLICER_NONINTERACTIVE='1'; & $p; if(-not $?) { exit 2 } }"
    await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',cmd],
      {timeout:1200000,output:fd})
    const installed=findSlicer()
    if(!installed)throw Error('Slicer installer finished but Slicer.exe was not located')
    state.components.slicer={status:'installed',verifiedAt:now(),executable:installed}
  }catch(e){state.components.slicer={status:'error',reason:String(e).slice(0,250)};log(p,'slicer: '+String(e))}
}
async function installSlicerHeart(p,state,fd){
  const slicerExe=findSlicer()
  if(!slicerExe){
    state.components.slicerheart={status:'deferred',reason:'Slicer.exe not found'}
    return
  }
  const script=join(p.root,'install-slicerheart.py')
  const content=[
    'import slicer',
    'em = slicer.app.extensionsManagerModel()',
    'em.interactive = False',
    "ok = em.isExtensionInstalled('SlicerHeart') or em.installExtensionFromServer('SlicerHeart', False)",
    "slicer.app.exit(0 if ok else 2)",
  ].join('\n')+'\n'
  writeFileSync(script,content,'utf8')
  try{
    await run(slicerExe,['--testing','--no-splash','--no-main-window','--python-script',script],{timeout:360000,output:fd})
    state.components.slicerheart={status:'installed',verifiedAt:now(),note:'Slicer extension manager reported success'}
  }catch(e){
    state.components.slicerheart={status:'error',reason:String(e).slice(0,250)}
    log(p,'slicerheart: '+String(e))
  }
}

async function installViewer(p,state,fd){
  const cwd=join(p.root,'viewer')
  const modulesRoot=join(cwd,'node_modules','three')
  const checks=['build/three.module.js','build/three.core.js','examples/jsm/loaders/GLTFLoader.js','examples/jsm/controls/OrbitControls.js','examples/jsm/utils/BufferGeometryUtils.js']
  const pkg=join(modulesRoot,'package.json')
  try{
    if(existsSync(pkg)&&checks.every(x=>existsSync(join(modulesRoot,x)))&&
       JSON.parse(readFileSync(pkg,'utf8')).version==='0.181.2'){
      state.components.viewer={status:'installed',version:'0.181.2',verifiedAt:now()}
      return
    }
    mkdirSync(cwd,{recursive:true})
    const npmCli=join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js')
    if(!existsSync(npmCli))throw Error('No verified npm-cli.js beside Node installation; install Node with npm')
    await run(process.execPath,[npmCli,'install','--no-save','--no-package-lock','--ignore-scripts','--no-audit','--no-fund','--prefix',cwd,'three@0.181.2'],
      {cwd,timeout:300000,output:fd})
    if(!existsSync(pkg)||JSON.parse(readFileSync(pkg,'utf8')).version!=='0.181.2'||
       !checks.every(x=>existsSync(join(modulesRoot,x))))throw Error('Three.js version or module files invalid')
    state.components.viewer={status:'installed',version:'0.181.2',verifiedAt:now()}
  }catch(e){
    state.components.viewer={status:'error',reason:String(e).slice(0,220)}
    log(p,'viewer: '+String(e))
  }
}

async function probeResearchEngines(state){
  const distro=process.env.PHOENIX_ANATOMY_WSL_DISTRO||'Ubuntu-24.04'
  const windows=process.platform==='win32'
  const openCarpArgs=windows?['--distribution',distro,'--exec','openCARP','-buildinfo']:['-buildinfo']
  try{
    await run(windows?'wsl.exe':(process.env.PHOENIX_OPENCARP_BIN||'openCARP'),openCarpArgs,{timeout:15000})
    state.components.opencarp={status:'installed',mode:windows?'wsl2':'native',verifiedAt:now()}
  }catch{
    state.components.opencarp={status:'external',reason:'Install openCARP in Ubuntu WSL2/Linux; verify openCARP -buildinfo'}
  }
  const sv=process.env.PHOENIX_SIMVASCULAR_BIN
  if(windows){
    if(sv&&/^\/usr\/local\/sv\/simvascular\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/simvascular$/.test(sv)){
      try{
        await run('wsl.exe',['--distribution',distro,'--exec','/usr/bin/test','-x',sv],{timeout:12000})
        state.components.simvascular={status:'installed',mode:'wsl2',verifiedAt:now()}
      }catch{state.components.simvascular={status:'external',reason:'Configured WSL SimVascular binary is not executable'}}
    }else state.components.simvascular={status:'external',reason:'Set verified PHOENIX_SIMVASCULAR_BIN in WSL2'}
  }else{
    state.components.simvascular=sv&&existsSync(sv)?
      {status:'installed',mode:'native',verifiedAt:now()}:
      {status:'external',reason:'Install official SimVascular and set PHOENIX_SIMVASCULAR_BIN'}
  }
}

async function worker(env=process.env){
  const p=pathsFor(env)
  mkdirSync(p.root,{recursive:true})
  const fd=openSync(p.log,'a')
  const state=load(p)||{components:{}}
  state.components||={}
  state.platform=process.platform
  try{
    log(p,'Starting anatomy bootstrap; installation does not imply clinical validation')
    await installPythonComponents(p,state,fd)
    await installBaselineWeights(p,state,fd,env)
    save(p,state)
    await installSlicer(p,state,fd)
    await installSlicerHeart(p,state,fd)
    await probeResearchEngines(state)
    await installViewer(p,state,fd)
    state.clinicalValidation='not-validated'
    save(p,state)
    state.bootstrap={status:'finished',at:now()}
    save(p,state)
    log(p,'Bootstrap finished; review manifest and install.log for partial failures')
  }catch(e){
    state.bootstrap={status:'error',at:now(),reason:String(e).slice(0,250)}
    save(p,state)
    log(p,'Bootstrap fatal: '+String(e))
    throw e
  }finally{
    closeSync(fd)
    try{rmSync(p.lock,{force:true})}catch{}
  }
}
export function status(env=process.env){
  const p=pathsFor(env),v=load(p),components=v?.components||{}
  const coreReady=existsSync(p.python)&&modules.every(m=>components[m.id]?.status==='installed')
  const viewerReady=components.viewer?.status==='installed'&&
    existsSync(join(p.root,'viewer','node_modules','three','build','three.module.js'))
  const weightsReady=components.weights_ct?.status==='installed'&&
    existsSync(join(weightsRoot(env),'nnunet','results'))
  const missing=[...modules.map(m=>m.id),'weights_ct','viewer','slicer','slicerheart']
    .filter(id=>components[id]?.status!=='installed')
  return {root:p.root,manifest:p.manifest,log:p.log,initialized:!!v,
    installed:coreReady&&viewerReady&&weightsReady&&
      components.slicer?.status==='installed'&&components.slicerheart?.status==='installed',
    coreReady,viewerReady,weightsReady,missing,
    backgroundInstallRunning:existsSync(p.lock),bootstrap:v?.bootstrap??null,
    components,clinicallyValidated:false,
    notes:'Package installation does not imply every atlas, a verified patient model or clinical validation.'}
}
export function ensure(env=process.env,launch=spawn){
  const p=pathsFor(env)
  if(env.PHOENIX_ANATOMY_AUTO_INSTALL==='0'||env.CI==='true'||env.NODE_ENV==='test')
    return {status:'disabled',...status(env)}
  const current=status(env)
  if(!needsInstall(load(p))&&env.PHOENIX_ANATOMY_FORCE_INSTALL!=='1'&&
     existsSync(p.python)&&current.viewerReady&&
     (current.weightsReady||current.components.weights_ct?.status==='disabled'))
    return {status:'up-to-date',...current}
  mkdirSync(p.root,{recursive:true})
  try{
    const age=Date.now()-statSync(p.lock).mtimeMs
    if(age>=-60000&&age<60*60*1000)return {status:'running',...status(env)}
    rmSync(p.lock,{force:true})
  }catch{}
  try{const fd=openSync(p.lock,'wx');closeSync(fd)}catch{return {status:'running',...status(env)}}
  try{
    const child=launch(process.execPath,[self,'--worker'],{
      cwd:resolve(fileURLToPath(new URL('..',import.meta.url))),detached:true,
      windowsHide:true,shell:false,env,stdio:'ignore'})
    child.unref()
    return {status:'started',...status(env)}
  }catch(e){
    rmSync(p.lock,{force:true});log(p,'launch error '+String(e))
    return {status:'error',error:String(e),...status(env)}
  }
}
if(process.argv[1]&&resolve(process.argv[1])===self){
  if(process.argv.includes('--worker')||process.argv.includes('--install'))worker().then(()=>{
    if(process.argv.includes('--install'))console.log(JSON.stringify(status(),null,2))
  }).catch(e=>{
    const p=pathsFor();log(p,'FATAL '+String(e));try{rmSync(p.lock,{force:true})}catch{}
    process.exitCode=1
  })
  else if(process.argv.includes('--status'))console.log(JSON.stringify(status(),null,2))
  else console.log(JSON.stringify(ensure(),null,2))
}
