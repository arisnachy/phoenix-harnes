#!/usr/bin/env node
/**
 * Non-destructive official Blender Lab MCP stdio handshake smoke.
 * Starts the pinned MCP server and enumerates its tools. NEVER invokes a tool,
 * runs model-supplied Python or starts Blender. Does not claim the add-on works.
 * Run: node scripts/phoenix-blender-mcp-handshake.mjs
 */
import { spawn } from 'node:child_process'
import { win32 } from 'node:path'
import { existsSync } from 'node:fs'

const SOURCE = 'git+https://projects.blender.org/lab/blender_mcp.git@v1.0.2#subdirectory=mcp'
const timeout = 60_000
const getEnv = (name) => Object.entries(process.env)
  .find(([key]) => key.toUpperCase() === name)?.[1]

function safeEnv() {
  const env = {}
  for (const [name,value] of Object.entries(process.env)) {
    if (value === undefined
      || /KEY|PASSWORD|SECRET|TOKEN/iu.test(name)
      || /^DSH_/iu.test(name)
      || /^(LD_PRELOAD|LD_AUDIT|NODE_OPTIONS|DYLD_.*)$/iu.test(name)
      || /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/iu.test(name)) continue
    env[name] = value
  }
  return env
}

function uvxExecutable() {
  const explicit=getEnv('PHOENIX_BLENDER_MCP_COMMAND')
  if (explicit && existsSync(explicit)) return explicit
  if (process.platform !== 'win32') return 'uvx'
  const user=getEnv('USERPROFILE')
  const local=getEnv('LOCALAPPDATA')
  const installed=getEnv('UV_INSTALL_DIR')
  const path=getEnv('PATH')??''
  const candidates=[
    ...path.split(';').map(dir=>win32.join(dir,'uvx.exe')),
    installed && win32.join(installed,'uvx.exe'),
    user && win32.join(user,'.local','bin','uvx.exe'),
    user && win32.join(user,'.cargo','bin','uvx.exe'),
    local && win32.join(local,'Microsoft','WinGet','Links','uvx.exe'),
    local && win32.join(local,'Programs','uv','uvx.exe'),
  ]
  return candidates.find(file=>file&&win32.isAbsolute(file)&&existsSync(file))??'uvx'
}

const child = spawn(uvxExecutable(), ['--from',SOURCE,'blender-mcp'],{
  env:safeEnv(),stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true,
})
let stderr=''
child.stdin.on('error',error=>finish(1,'MCP stdio write failed: '+error.message))
let buffer=''
let settled=false
let initialized=false
const deadline=setTimeout(()=>finish(1,'MCP handshake timeout; inspect stderr'),timeout)
deadline.unref()
function finish(code,message) {
  if(settled)return
  settled=true
  clearTimeout(deadline)
  child.kill()
  process.stdout.write(JSON.stringify({
    ok:code===0,
    message,
    stderrTail:stderr.slice(-3000),
  },null,2)+'\n')
  process.exitCode=code
}
function send(payload) {
  if(!settled && child.stdin.writable)child.stdin.write(JSON.stringify(payload)+'\n')
}
send({
  jsonrpc:'2.0',id:1,method:'initialize',
  params:{
    protocolVersion:'2025-03-26',
    capabilities:{},clientInfo:{name:'phoenix-blender-stdio-smoke',version:'1.0.0'},
  },
})
child.stderr.setEncoding('utf8')
child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-6000)})
child.stdout.setEncoding('utf8')
child.stdout.on('data',chunk=>{
  if(settled)return
  buffer+=chunk
  if(buffer.length>2_000_000){finish(1,'Unexpectedly large MCP stdout response');return}
  for(let eol=buffer.indexOf('\n');eol>=0;eol=buffer.indexOf('\n')){
    const line=buffer.slice(0,eol).trim()
    buffer=buffer.slice(eol+1)
    if(!line)continue
    let response
    try{response=JSON.parse(line)}catch{finish(1,'Invalid JSON-RPC response from server');return}
    if(response.id===1){
      if(response.error){finish(1,'MCP initialize failed: '+String(response.error.message??'unknown'));return}
      if(!response.result?.capabilities){finish(1,'MCP initialize lacks capabilities');return}
      initialized=true
      send({jsonrpc:'2.0',method:'notifications/initialized'})
      send({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})
    }else if(response.id===2){
      const tools=response.result?.tools
      if(response.error||!Array.isArray(tools)||tools.length===0){
        finish(1,'MCP tools/list failed or returned no tools')
      }else if(!initialized){
        finish(1,'MCP tools arrived before initialize')
      }else{
        finish(0,`MCP initialized; ${tools.length} Blender tools exported (add-on interaction not tested)`)
      }
      return
    }
  }
})
child.once('error',error=>finish(1,'Failed to start official uvx MCP: '+error.message))
child.once('exit',(code,signal)=>{
  if(!settled)finish(1,'Blender MCP exited before tools/list: '+String(code??signal))
})
