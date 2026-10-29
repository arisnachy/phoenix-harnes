#!/usr/bin/env node
/**
 * Non-blocking Phoenix auto-update adjunct. One local installer per user with
 * bounded retries; the application remains usable if external sites are down.
 * This launcher is invoked on Windows startup and after stable activation.
 */
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot=resolve(fileURLToPath(new URL('..',import.meta.url)))
const home=resolve(process.env.PHOENIX_SPORTS_SOURCE_HOME||join(homedir(),'.phoenix','sports-sources'))
const state=join(home,'manifest.json')
const lock=join(home,'install.lock')
const log=join(home,'install.log')
const installer=join(sourceRoot,'scripts','phoenix-sports-source-bootstrap.mjs')
const required=[
  'OddsHarvester + Playwright',
  'SportsbookReview NFL/NBA/NHL/MLB archive',
  'MLB historic dataset and scraper sources',
]
export function shouldBootstrap(manifest,now=Date.now()){
  if(!manifest||manifest.schema!==2||!manifest.components)return true
  if(required.every(name=>manifest.components[name]?.status==='installed'))return false
  const updated=Date.parse(manifest.updatedAt??'')
  return !Number.isFinite(updated)||now-updated>=60*60*1000
}
function ready(){
  try {
    const data=JSON.parse(readFileSync(state,'utf8'))
    if(shouldBootstrap(data))return false
    const exe=data.paths?.executable,archive=data.paths?.history
    return Boolean(exe&&archive&&existsSync(exe)&&
      ['nba','mlb','nfl','nhl'].every(s=>existsSync(join(archive,'sportsbookreview-'+s+'.json')))&&
      existsSync(join(archive,'mlb-odds.json')))
  }catch{return false}
}
function unlink(){try{unlinkSync(lock)}catch{ /* no-op */ }}
async function worker(){
  if(!existsSync(installer)){unlink();return}
  const out=openSync(log,'a')
  try{
    const child=spawn(process.execPath,[installer,'--auto-install'],{
      cwd:sourceRoot,env:process.env,stdio:['ignore',out,out],windowsHide:true,shell:false,
    })
    const exit=await new Promise(resolve=>{
      child.once('error',()=>resolve(1))
      child.once('close',code=>resolve(code??1))
    })
    if(exit!==0)process.stderr.write('[PHOENIX SPORTS] Optional bootstrap incomplete; details: '+log+'\n')
  }finally{closeSync(out);unlink()}
}
export function start(launch=spawn){
  if(process.env.PHOENIX_SPORTS_SOURCES_AUTO_INSTALL==='0'||!existsSync(installer))return
  if(ready())return
  try{
    if(existsSync(state)){
      const prior=JSON.parse(readFileSync(state,'utf8'))
      const complete=required.every(name=>prior.components?.[name]?.status==='installed')
      if(!complete&&!shouldBootstrap(prior))return
    }
  }catch{ /* missing state */ }
  mkdirSync(home,{recursive:true})
  try{
    const age=Date.now()-statSync(lock).mtimeMs
    if(age>=0&&age<35*60*1000)return
    unlink()
  }catch{ /* no lock */ }
  let fd
  try{fd=openSync(lock,'wx')}catch{return}
  closeSync(fd)
  try{
    const child=launch(process.execPath,[fileURLToPath(import.meta.url),'--worker'],{
      cwd:sourceRoot,env:process.env,
      detached:true,windowsHide:true,shell:false,stdio:'ignore',
    })
    child.unref()
  }catch(error){
    unlink()
    console.error('[PHOENIX SPORTS] background install launcher: '+String(error))
  }
}
// This process only starts a detached worker, never downloads during startup.
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--worker'))worker().catch(e=>{unlink();console.error(e);process.exitCode=1})
  else start()
}
