#!/usr/bin/env node
/**
 * User-scoped sports installer launcher. The Windows supervisor's prepared
 * runtime does NOT necessarily carry scripts; fall back to the original
 * checkout (PHOENIX_INSTALL_ROOT). Never install synchronously on startup.
 */
import { spawn } from 'node:child_process'
import {
  closeSync,existsSync,mkdirSync,openSync,readFileSync,statSync,unlinkSync,
  appendFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join,resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const localRoot=resolve(fileURLToPath(new URL('..',import.meta.url)))
const filename=fileURLToPath(import.meta.url)
const required=[
  'OddsHarvester + Playwright',
  'SportsbookReview NFL/NBA/NHL/MLB archive',
  'MLB historic dataset and scraper sources',
]
const schema=3
const homeFor=(env)=>resolve(env.PHOENIX_SPORTS_SOURCE_HOME||
  join(homedir(),'.phoenix','sports-sources'))
const pathsFor=(env)=>{
  const home=homeFor(env)
  return{home,state:join(home,'manifest.json'),lock:join(home,'install.lock'),
    log:join(home,'install.log')}
}
export function resolveSportsInstaller(roots,exists=existsSync){
  const visited=new Set()
  for(const raw of roots){
    if(typeof raw!=='string'||!raw.trim())continue
    const root=resolve(raw)
    if(visited.has(root))continue
    visited.add(root)
    const path=join(root,'scripts','phoenix-sports-source-bootstrap.mjs')
    if(exists(path))return{root,path}
  }
  return null
}
export function shouldBootstrap(manifest,now=Date.now()){
  if(!manifest||manifest.schema!==schema||!manifest.components)return true
  if(required.every(name=>manifest.components[name]?.status==='installed'))return false
  const updated=Date.parse(manifest.updatedAt??'')
  return !Number.isFinite(updated)||now-updated>=60*60*1000
}
function complete(manifest,stateHome){
  if(shouldBootstrap(manifest))return false
  const exe=manifest.paths?.executable,history=manifest.paths?.history
  if(!exe||!history||!existsSync(exe))return false
  return ['nba','mlb','nfl','nhl'].every(s=>
    existsSync(join(history,'sportsbookreview-'+s+'.json')))
    &&existsSync(join(history,'mlb-odds.json'))
}
function loadState(file){
  try{return JSON.parse(readFileSync(file,'utf8'))}catch{return null}
}
function logEvent(path,message){
  try{
    appendFileSync(path,'['+new Date().toISOString()+'] '+message+'\n')
  }catch{/* logging must not prevent Phoenix startup */}
}
function unlink(file){try{unlinkSync(file)}catch{/* no-op */}}
async function worker(){
  const env=process.env,paths=pathsFor(env)
  mkdirSync(paths.home,{recursive:true})
  const source=resolveSportsInstaller([
    env.PHOENIX_SPORTS_BOOTSTRAP_ROOT,env.PHOENIX_INSTALL_ROOT,
    env.PHOENIX_RUNTIME_ROOT,localRoot,process.cwd(),
  ])
  if(!source){
    logEvent(paths.log,'ERROR: instalador no encontrado en runtime ni checkout')
    unlink(paths.lock)
    return
  }
  const output=openSync(paths.log,'a')
  try{
    logEvent(paths.log,'RUN installer from '+source.root)
    const child=spawn(process.execPath,[source.path,'--auto-install'],{
      cwd:source.root,env,stdio:['ignore',output,output],
      windowsHide:true,shell:false,
    })
    const exit=await new Promise(resolve=>{
      child.once('error',e=>{
        logEvent(paths.log,'ERROR spawn '+String(e))
        resolve(1)
      })
      child.once('close',code=>resolve(code??1))
    })
    logEvent(paths.log,'Installer exit code '+exit)
    if(exit!==0)process.stderr.write(
      '[PHOENIX SPORTS] Instalación parcial: '+paths.log+'\n')
  }finally{closeSync(output);unlink(paths.lock)}
}
/**
 * Returns a status, so health tools can tell Kira exactly whether a repair
 * was launched, already running or could not find the source checkout.
 */
export function start(launch=spawn,env=process.env,{force=false}={}){
  const paths=pathsFor(env)
  if(env.PHOENIX_SPORTS_SOURCES_AUTO_INSTALL==='0'||env.CI==='true'
    ||env.NODE_ENV==='test')
    return{status:'disabled',logPath:paths.log}
  const source=resolveSportsInstaller([
    env.PHOENIX_INSTALL_ROOT,env.PHOENIX_RUNTIME_ROOT,localRoot,process.cwd(),
  ])
  if(!source)return{status:'missing-installer',logPath:paths.log}
  const manifest=loadState(paths.state)
  if(complete(manifest,paths.home))return{status:'installed',logPath:paths.log}
  if(manifest&&!shouldBootstrap(manifest)){
    const partial=required.some(name=>
      manifest.components[name]?.status!=='installed')
    if(partial&&!force)return{status:'retry-cooldown',logPath:paths.log}
  }
  mkdirSync(paths.home,{recursive:true})
  try{
    const age=Date.now()-statSync(paths.lock).mtimeMs
    if(age>=0&&age<35*60*1000)return{status:'running',logPath:paths.log}
    unlink(paths.lock)
  }catch{/* no lock */}
  let fd
  try{fd=openSync(paths.lock,'wx')}
  catch{return{status:'running',logPath:paths.log}}
  closeSync(fd)
  try{
    logEvent(paths.log,'Launching background installer using '+source.root)
    const child=launch(process.execPath,[filename,'--worker'],{
      cwd:source.root,
      env:{...env,PHOENIX_SPORTS_BOOTSTRAP_ROOT:source.root},
      detached:true,windowsHide:true,shell:false,stdio:'ignore',
    })
    child.unref()
    return{status:'started',logPath:paths.log}
  }catch(error){
    logEvent(paths.log,'ERROR launcher: '+String(error))
    unlink(paths.lock)
    return{status:'launch-error',logPath:paths.log,
      error:String(error).slice(0,200)}
  }
}
if(process.argv[1]&&resolve(process.argv[1])===filename){
  if(process.argv.includes('--worker'))
    worker().catch(error=>{
      const p=pathsFor(process.env)
      logEvent(p.log,'ERROR worker: '+String(error))
      unlink(p.lock)
      process.exitCode=1
    })
  else {
    const result=start(spawn,process.env,{force:process.argv.includes('--force')})
    if(process.argv.includes('--json'))console.log(JSON.stringify(result))
  }
}
