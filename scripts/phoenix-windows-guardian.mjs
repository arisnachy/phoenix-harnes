#!/usr/bin/env node
/**
 * PHOENIX user-session guardian — Windows optional failover for the supervisor.
 * The existing phoenix-windows-supervisor.mjs remains the sole Host owner.
 *
 * Guard: validate the WHOLE supervisor process identity before doing anything.
 * Never kill a process, rewrite settings, prompt for credentials, or launch
 * an unknown executable. Installed separately through an explicit task opt-in.
 */
import { spawn,spawnSync } from 'node:child_process'
import { readFileSync,existsSync } from 'node:fs'
import { resolve,dirname,join,isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const SUPERVISOR=join(ROOT,'scripts','phoenix-windows-supervisor.mjs')
const HEARTBEAT='phoenix-update-supervisor-heartbeat.json'
const INTERVAL_MS=30_000
const RESTART_LIMIT=4
const RESTART_WINDOW_MS=10*60_000

export function decideGuardianAction(input) {
  if(input.observed==='phoenix-supervisor')return 'healthy'
  if(input.observed==='unknown')return 'hold'
  if((input.recentRestarts??0)>=RESTART_LIMIT)return 'backoff'
  return 'start'
}
function commonDir() {
  const r=spawnSync('git',['rev-parse','--git-common-dir'],{
    cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:2500,
  })
  if(r.status!==0||typeof r.stdout!=='string')return null
  const value=r.stdout.trim()
  if(!value||value.length>500)return null
  return resolve(isAbsolute(value)?value:join(ROOT,value))
}
function heartbeat(dir) {
  try{
    const raw=readFileSync(join(dir,HEARTBEAT),'utf8')
    if(raw.length>5000)return undefined
    const data=JSON.parse(raw)
    if(!data||typeof data!=='object'||Array.isArray(data))return undefined
    const item=data
    if(item.schema!==1)return undefined
    return {
      supervisorPid:typeof item.supervisorPid==='number'?item.supervisorPid:undefined,
      at:typeof item.at==='string'?item.at:undefined,
    }
  }catch{return undefined}
}
function processIdentity(pid) {
  if(!Number.isSafeInteger(pid)||pid<=0||pid>0x7fffffff)return 'absent'
  const script=`$p=Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue
if($null -eq $p){'ABSENT'}elseif([string]::IsNullOrWhiteSpace($p.CommandLine)){'UNKNOWN'}elseif($p.CommandLine -like '*phoenix-windows-supervisor.mjs*'){'PHOENIX'}else{'OTHER'}`
  const check=spawnSync('powershell.exe',[
    '-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',
    Buffer.from(script,'utf16le').toString('base64'),
  ],{encoding:'utf8',windowsHide:true,timeout:4500,maxBuffer:10240,stdio:['ignore','pipe','ignore']})
  if(check.error||check.status!==0)return 'unknown'
  const answer=check.stdout?.trim()
  if(answer==='PHOENIX')return 'phoenix-supervisor'
  if(answer==='OTHER')return 'other-process'
  if(answer==='ABSENT')return 'absent'
  return 'unknown'
}
function start() {
  if(!existsSync(SUPERVISOR))return false
  try{
    const child=spawn(process.execPath,[SUPERVISOR],{
      cwd:ROOT,windowsHide:true,detached:true,stdio:'ignore',env:process.env,
    })
    child.unref()
    return typeof child.pid==='number'&&child.pid>0
  }catch{return false}
}
async function main() {
  if(process.platform!=='win32')throw Error('PHOENIX Guardian runs only on Windows')
  const dir=commonDir()
  if(!dir)throw Error('Cannot verify PHOENIX Git control directory')
  const restarts=[]
  while(true){
    const now=Date.now()
    const state=heartbeat(dir)
    const observed=state?.supervisorPid===undefined?'absent':processIdentity(state.supervisorPid)
    while(restarts.length&&now-restarts[0]>=RESTART_WINDOW_MS)restarts.shift()
    const action=decideGuardianAction({heartbeat:state,observed,recentRestarts:restarts.length})
    if(action==='start'){
      if(start()){
        restarts.push(now)
        process.stderr.write('[PHOENIX Guardian] Verified missing supervisor; restart submitted.\n')
      }else{
        process.stderr.write('[PHOENIX Guardian] Restart not possible; source runtime not available.\n')
      }
    }else if(action==='backoff'){
      process.stderr.write('[PHOENIX Guardian] Repeated failures: automatic restart is paused for safety.\n')
    }
    await new Promise(resolve=>setTimeout(resolve,INTERVAL_MS))
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    process.stderr.write('[PHOENIX Guardian] '+(error instanceof Error?error.message:'Cannot start')+'\n')
    process.exitCode=1
  })
}
