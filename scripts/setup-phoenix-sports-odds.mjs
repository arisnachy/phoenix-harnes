#!/usr/bin/env node
/**
 * Explicit, reproducible keyless sports setup. Does not touch any API key.
 * Install: pnpm sports:odds:setup. Requires internet, Python >=3.12 and Playwright's Chromium.
 */
import {spawnSync} from 'node:child_process'

const installed='oddsharvester==0.13.0'
function run(program,args){
  const result=spawnSync(program,args,{stdio:'inherit',shell:false,windowsHide:true,
    env:{...process.env,THE_ODDS_API_KEY:undefined,THEODDSAPI_API_KEY:undefined,
      OPENAI_API_KEY:undefined,DEEPSEEK_API_KEY:undefined}})
  return result.status===0
}
function available(program,args=['--version']){
  const result=spawnSync(program,args,{stdio:'ignore',shell:false,windowsHide:true,timeout:5000})
  return result.status===0
}
if(available('uv')){
  if(!run('uv',['tool','install',installed]))process.exitCode=1
  if(!run('uvx',['--from',installed,'python','-m','playwright','install','chromium']))process.exitCode=1
  if(process.exitCode!==1&&!run('uvx',['--from',installed,'oddsharvester','--help']))process.exitCode=1
}else{
  const python=['python3.12','python','py'].find(x=>available(x,x==='py'?['-3.12','--version']:['--version']))
  if(!python){
    console.error('Instala Python 3.12+ y uv (https://docs.astral.sh/uv/), luego vuelve a ejecutar pnpm sports:odds:setup')
    process.exitCode=1
  }else{
    const prefix=python==='py'?['-3.12']:[]
    if(!run(python,[...prefix,'-m','pip','install','--user',installed]))process.exitCode=1
    if(!run(python,[...prefix,'-m','playwright','install','chromium']))process.exitCode=1
  }
}
if(process.exitCode!==1)console.log('OddsHarvester configurado. La disponibilidad real de cuotas depende de la fuente pública, el país y el mercado; consulta sports_chat_odds_sources desde Kira.')
