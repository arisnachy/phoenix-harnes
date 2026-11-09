#!/usr/bin/env node
/**
 * Live (no API key) source probe. Runs from GitHub Actions or Phoenix host,
 * NOT a synthetic unit test. HTTP 200 alone is never considered usable data.
 * Report degradations as explicit evidence; an outage must not block UI builds.
 */
import {mkdir,writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
const nba='https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
const nfl='https://site.api.espn.com/apis/site/v2/sports/football/nfl'
const targets=[
  ['nba-scoreboard',nba+'/scoreboard','scoreboard'],
  ['nfl-scoreboard',nfl+'/scoreboard','scoreboard'],
  ['nba-injuries',nba+'/injuries','injuries'],
  ['nfl-injuries',nfl+'/injuries','injuries'],
  ['nba-depthcharts-bos',nba+'/teams/2/depthcharts','depthcharts'],
  ['nfl-depthcharts-nyg',nfl+'/teams/19/depthcharts','depthcharts'],
  ['nba-cdn-scoreboard','https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json','nba-cdn'],
  ['nba-injury-official','https://official.nba.com/nba-injury-report-2026-27-season/','nba-official'],
  ['nfl-injury-official','https://www.nfl.com/injuries/','nfl-official'],
]
const shape=(type,payload)=>{
  const p=payload!==null&&typeof payload==='object'?payload:{}
  if(type==='scoreboard')return Array.isArray(p.events)
  if(type==='injuries')return Array.isArray(p.injuries)
  if(type==='depthcharts')return !!(p.depthchart||p.depthcharts||p.positions)
  if(type==='nba-cdn')return Array.isArray(p.scoreboard?.games)
  return false
}
const probe=async([id,url,type])=>{
  const checkedAt=new Date().toISOString()
  try{
    const response=await fetch(url,{signal:AbortSignal.timeout(8500),
      headers:{accept:type.includes('official')?'text/html':'application/json',
        'user-agent':'PHOENIX/1.0 (read-only-source-health-probe)'}})
    const mime=response.headers.get('content-type')||''
    const status=response.status
    if(!response.ok)return{id,url,checkedAt,status,usable:false,reason:'HTTP '+status}
    const advertisedSize=Number(response.headers.get('content-length')||0)
    if(advertisedSize>10_000_000)return{id,url,checkedAt,status,usable:false,
      reason:'Response exceeds 10MB read limit'}
    const raw=await response.text()
    if(raw.length>10_000_000)return{id,url,checkedAt,status,usable:false,
      reason:'Body exceeds 10MB read limit'}
    let usable=false,detail=''
    if(type.endsWith('official')){
      usable=mime.includes('html')&&/injur|injur(y|ies)/i.test(raw)
      detail=usable?'Official page reachable; latest individual statuses NOT parsed':
        'Official HTML expected'
    }else{
      const payload=JSON.parse(raw)
      usable=shape(type,payload)
      detail=usable?'Expected JSON structure found; player statuses NOT validated':
        'Missing expected JSON keys / empty stub'
      if(type==='injuries'&&usable&&payload.injuries.length===0)
        detail+=' (empty injuries array; not proof that all players are healthy)'
    }
    return{id,url,checkedAt,status,usable,reason:detail,
      bytes:raw.length,contentType:mime}
  }catch(error){
    return{id,url,checkedAt,status:null,usable:false,
      reason:(error instanceof Error?error.message:String(error)).slice(0,180)}
  }
}
const results=[]
for(let i=0;i<targets.length;i+=3){
  results.push(...await Promise.all(targets.slice(i,i+3).map(probe)))
  if(i+3<targets.length)await new Promise(resolve=>setTimeout(resolve,350))
}
const observedAt=new Date().toISOString()
const json={observedAt,sourceClass:'public-no-key',guaranteedAvailability:false,
  important:'200/JSON shape confirms reachability only. NBA lineups/QBs/inactives require direct game-day confirmation.',
  sources:results,total:results.length,usable:results.filter(x=>x.usable).length}
const out=process.env.PHOENIX_SPORTS_HEALTH_OUT||'artifacts/nba-nfl-keyless-health.json'
await mkdir(dirname(out),{recursive:true})
await writeFile(out,JSON.stringify(json,null,2)+'\n')
for(const x of results)console.log((x.usable?'OK':'DEGRADED')+' | '+x.id+
  ' | HTTP '+(x.status??'network-failure')+' | '+x.reason)
console.log(JSON.stringify({observedAt,usable:json.usable,total:json.total,out}))
if(process.env.GITHUB_STEP_SUMMARY){
  const {appendFile}=await import('node:fs/promises')
  await appendFile(process.env.GITHUB_STEP_SUMMARY,
    '## PHOENIX NBA/NFL no-key sources\n\n'+
    'Probed '+json.total+' URLs at '+observedAt+'. Schema-usable: **'+json.usable+'**. '+
    'Unverified player availability remains conditional.\n\n'+
    '| Source | HTTP | JSON/HTML shape |\n| --- | ---: | --- |\n'+
    results.map(x=>'| '+x.id+' | '+(x.status??'network-error')+' | '+
      (x.usable?'usable':'degraded')+' |').join('\n')+'\n')
}
