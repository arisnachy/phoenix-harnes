#!/usr/bin/env node
/**
 * PHOENIX Sports managed sources: idempotent installation in the user's home.
 * Never touches the Git worktree, user credentials, or a running model.
 * Installer runs in a separate process from the stable updater: Python and
 * Playwright availability cannot break Phoenix startup or rollback.
 */
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

export const SPORTS_INSTALL_VERSION=2
export const ODDSHARVESTER_VERSION='0.20.0'
const upstream={
  'sportsbookreview-scraper':'https://github.com/flancast90/sportsbookreview-scraper.git',
  'mlb-odds-scraper':'https://github.com/ArnavSaraogi/mlb-odds-scraper.git',
}
const dataset='https://github.com/ArnavSaraogi/mlb-odds-scraper/releases/download/dataset/mlb_odds_dataset.json'
const home=resolve(process.env.PHOENIX_SPORTS_SOURCE_HOME||join(homedir(),'.phoenix','sports-sources'))
const archive=join(home,'history')
const vendor=join(home,'vendor')
const venv=join(home,'.venv')
const exe=process.platform==='win32'?join(venv,'Scripts'):join(venv,'bin')
const py=join(exe,process.platform==='win32'?'python.exe':'python')
const cli=join(exe,process.platform==='win32'?'oddsharvester.exe':'oddsharvester')
const state=join(home,'manifest.json')
const exists=async path=>access(path).then(()=>true,()=>false)
const flags=new Set(process.argv.slice(2))
export const manifestPath=state

function run(bin,args,{cwd=home,timeout=300_000}={}) {
  return new Promise((ok,fail)=>{
    const child=spawn(bin,args,{cwd,stdio:'inherit',shell:false,windowsHide:true})
    const timeoutId=setTimeout(()=>{child.kill();fail(Error(bin+' timed out'))},timeout)
    child.once('error',error=>{clearTimeout(timeoutId);fail(error)})
    child.once('close',code=>{
      clearTimeout(timeoutId)
      if(code===0)ok()
      else fail(Error(bin+' exit '+code))
    })
  })
}
async function cloneOnce(name,url) {
  const dest=join(vendor,name)
  if(await exists(join(dest,'.git')))return dest
  if(await exists(dest))await rm(dest,{recursive:true,force:true})
  await run('git',['clone','--depth','1','--',url,dest],{timeout:180_000})
  if(!await exists(join(dest,'.git')))throw Error('Repository not cloned: '+name)
  return dest
}
async function downloadBounded(url,dest,maxBytes=100_000_000) {
  if(await exists(dest)){
    const size=(await stat(dest)).size
    if(size>1_000_000&&size<=maxBytes)return
  }
  const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(180_000)})
  if(!response.ok||!response.body)throw Error('Historic dataset HTTP '+response.status)
  const temp=dest+'.partial'
  await rm(temp,{force:true})
  let received=0
  try {
    await pipeline(Readable.fromWeb(response.body),
      new Transform({transform(chunk,_enc,done){
        received+=chunk.length
        if(received>maxBytes)done(Error('Historical dataset exceeds size limit'))
        else done(null,chunk)
      }}),
      createWriteStream(temp,{flags:'wx'}))
    if(received<1_000_000)throw Error('Dataset unexpectedly small')
    await rename(temp,dest)
  } catch(error){await rm(temp,{force:true});throw error}
}
export function verifyManifestShape(value){
  return value!==null&&typeof value==='object'&&!Array.isArray(value)
    &&value.schema===SPORTS_INSTALL_VERSION
    &&value.paths?.executable===cli&&value.paths?.history===archive
    &&typeof value.components==='object'
}
async function loadState() {
  try {
    const value=JSON.parse(await readFile(state,'utf8'))
    return verifyManifestShape(value)?value:null
  }catch{return null}
}
async function save(components){
  await mkdir(home,{recursive:true})
  const value={
    schema:SPORTS_INSTALL_VERSION,updatedAt:new Date().toISOString(),
    sources:['jordantete/OddsHarvester','flancast90/sportsbookreview-scraper','ArnavSaraogi/mlb-odds-scraper'],
    paths:{executable:cli,history:archive},components,
    activeScrapingAllowed:true,
    note:'Local installation does not prove live OddsPortal access, bookmaker prices or an unlimited data feed.',
  }
  const tmp=state+'.partial'
  await writeFile(tmp,JSON.stringify(value,null,2)+'\n','utf8')
  await rename(tmp,state)
  return value
}
async function installPython(){
  if(!await exists(py)){
    const choices=process.platform==='win32'?
      [['py',['-3','-m','venv',venv]],['python',['-m','venv',venv]]]:
      [['python3',['-m','venv',venv]],['python',['-m','venv',venv]]]
    let failure
    for(const [program,args] of choices){
      try{await run(program,args,{timeout:120_000});failure=undefined;break}
      catch(e){failure=e}
    }
    if(failure)throw Error('Python 3 missing or venv creation failed: '+failure.message)
  }
  // The executable alone does not prove the pinned distribution version.
  // OddsHarvester documents --help, not necessarily --version.
  const verifyPinned=()=>run(py,['-c',
    'import importlib.metadata as m, sys; sys.exit(m.version("oddsharvester") != "'+
      ODDSHARVESTER_VERSION+'")'],{timeout:15000})
  if(await exists(cli)){
    try {
      await verifyPinned()
      await run(cli,['--help'],{timeout:15000})
      await run(py,['-m','playwright','install','chromium'],{timeout:240_000})
      return
    }
    catch{ /* repair missing or wrong-version installation */ }
  }
  await run(py,['-m','pip','install','--disable-pip-version-check','oddsharvester=='+ODDSHARVESTER_VERSION],
    {timeout:240_000})
  await verifyPinned()
  await run(py,['-m','playwright','install','chromium'],{timeout:240_000})
  await run(cli,['--help'],{timeout:15_000})
}
async function installHistory(){
  const sbr=await cloneOnce('sportsbookreview-scraper',upstream['sportsbookreview-scraper'])
  const sports=['nba','mlb','nfl','nhl']
  for(const sport of sports){
    const from=join(sbr,'data',sport+'_archive_10Y.json')
    if(!await exists(from))throw Error('SportsbookReview '+sport+' archive missing upstream')
    const to=join(archive,'sportsbookreview-'+sport+'.json')
    if(!await exists(to))await copyFile(from,to)
    const size=(await stat(to)).size
    if(size<1000||size>100_000_000)throw Error('Invalid SBR archive '+sport)
  }
  return sports
}
async function installMlb(){
  await cloneOnce('mlb-odds-scraper',upstream['mlb-odds-scraper'])
  await downloadBounded(dataset,join(archive,'mlb-odds.json'))
}
export async function install(){
  await mkdir(vendor,{recursive:true});await mkdir(archive,{recursive:true})
  const previous=await loadState()
  const components={...(previous?.components??{})}
  const steps=[
    ['OddsHarvester + Playwright',installPython],
    ['SportsbookReview NFL/NBA/NHL/MLB archive',installHistory],
    ['MLB historic dataset and scraper sources',installMlb],
  ]
  for(const [name,action] of steps){
    try{
      await action()
      components[name]={status:'installed',at:new Date().toISOString()}
      process.stdout.write('[PHOENIX SPORTS] '+name+' OK\n')
    }catch(error){
      components[name]={status:'error',at:new Date().toISOString(),
        message:String(error instanceof Error?error.message:error).slice(0,300)}
      process.stderr.write('[PHOENIX SPORTS] '+name+' unavailable: '+components[name].message+'\n')
    }
    await save(components)
  }
  const usable=Object.values(components).filter(row=>row.status==='installed').length
  if(usable<3)process.exitCode=2
  return{home,usable,components}
}
export async function status(){
  const value=await loadState()
  return {home,configured:value!==null,components:value?.components??{},
    executable:await exists(cli),history:await exists(archive)}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  if(flags.has('--status')){
    status().then(v=>console.log(JSON.stringify(v))).catch(e=>{console.error(e);process.exitCode=1})
  }else if(flags.has('--install')||flags.has('--auto-install')||flags.size===0){
    install().catch(e=>{console.error('[PHOENIX SPORTS] fatal: '+String(e));process.exitCode=1})
  }else{console.error('Usage: --install | --auto-install | --status');process.exitCode=2}
}
