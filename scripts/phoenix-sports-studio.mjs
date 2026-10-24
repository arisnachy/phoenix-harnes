/**
 * Local-only Phoenix Sports Studio. Start: node scripts/phoenix-sports-studio.mjs
 * Secrets never reach the browser; external sports data require operator authorization.
 */
import {createServer} from 'node:http'
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises'
import {join,dirname} from 'node:path'
import {homedir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {SPORTS,SOURCES,sourceAuthorization,sourceScore,emptySourceRecord,observeSource,fetchGames,fetchOdds,discoverLeagues,discoverOddsSports,quoteTicket,gameDate,getJSON} from './phoenix-sports-engine.mjs'

const PORT=Number(process.env.PHOENIX_SPORTS_PORT||3107)
const HOME=process.env.PHOENIX_SPORTS_HOME||join(homedir(),'.dsh','sports')
const store=join(HOME,'intelligence.json')
const pathRoot=dirname(fileURLToPath(import.meta.url))
const MIME={'/':'text/html; charset=utf-8','/app.js':'text/javascript; charset=utf-8'}
const validSport=s=>typeof s==='string'&&Object.hasOwn(SPORTS,s)
const validLeague=s=>typeof s==='string'&&/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(s)
let saveQueue=Promise.resolve()
let state={version:1,observations:{},candidates:[]}
async function loadState(){
  try{
    const raw=JSON.parse(await readFile(store,'utf8'))
    if(raw.version===1&&raw.observations&&Array.isArray(raw.candidates))state=raw
  }catch(e){if(e.code!=='ENOENT')throw e}
}
async function saveState(){
  const snapshot=JSON.stringify(state,null,2)+'\n'
  saveQueue=saveQueue.then(async()=>{
    await mkdir(HOME,{recursive:true,mode:0o700})
    const temporary=store+'.'+randomUUID()+'.tmp'
    try {await writeFile(temporary,snapshot,{mode:0o600,flag:'wx'});await rename(temporary,store)}
    finally {try {await import('node:fs/promises').then(fs=>fs.rm(temporary,{force:true}))} catch {}}
  })
  await saveQueue
}
async function observe(id,ok,completeness){
  state.observations[id]=observeSource(state.observations[id]||emptySourceRecord(id),{ok,completeness})
  await saveState()
}
async function measured(id,work){
  const row=state.observations[id]
  if(row?.quarantined)throw new Error('Proveedor '+id+' en cuarentena tras cinco fallos consecutivos; revisar antes de reactivar.')
  try{
    const value=await work()
    await observe(id,true,Array.isArray(value)?(value.length?1:.6):1)
    return value
  }catch(e){await observe(id,false,0);throw e}
}
function json(res,status,payload){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','access-control-allow-origin':'null'})
  res.end(JSON.stringify(payload))
}
async function bodyJSON(req){
  let buffer=''
  for await(const part of req){
    buffer+=part.toString()
    if(buffer.length>50000)throw new Error('Solicitud demasiado grande')
  }
  try{return JSON.parse(buffer)}catch{throw new Error('JSON inválido')}
}
function sources(){
  return SOURCES.map(d=>{
    const auth=sourceAuthorization(d.id)
    return {...d,env:undefined,authorized:auth,health:sourceScore(state.observations[d.id]||emptySourceRecord(d.id),auth),observations:state.observations[d.id]||emptySourceRecord(d.id)}
  })
}
const immutableHeaders={
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'none'; connect-src 'self'; img-src 'self' https://a.espncdn.com https://img.mlbstatic.com; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'"
}
async function serveAsset(res,pathname){
  const file=pathname==='/'?'phoenix-sports-studio.html':'phoenix-sports-ui.js'
  const payload=await readFile(join(pathRoot,file))
  res.writeHead(200,{'content-type':MIME[pathname],...immutableHeaders})
  res.end(payload)
}
function checkSameOrigin(req){
  const origin=req.headers.origin
  const host=req.headers.host
  return (!origin||origin==='http://'+host)&&/^(localhost|127\.0\.0\.1):\d+$/u.test(host||'')
}
export async function handler(req,res){
  try{
    if(!checkSameOrigin(req)){json(res,403,{ok:false,error:'Solo origen local'});return}
    const u=new URL(req.url,'http://127.0.0.1:'+PORT)
    const path=u.pathname
    if(req.method==='GET'&&(path==='/'||path==='/app.js'))return await serveAsset(res,path)
    if(path==='/api/catalog'&&req.method==='GET')return json(res,200,{ok:true,sports:SPORTS,sources:sources(),candidates:state.candidates})
    if(path==='/api/board'&&req.method==='GET'){
      const sport=u.searchParams.get('sport')||'baseball'
      const league=u.searchParams.get('league')||'mlb'
      if(!validSport(sport)||!validLeague(league))throw new Error('Sport/league inválidos')
      if(!SPORTS[sport].includes(league)&&!state.candidates.some(c=>c.sport===sport&&c.league===league&&c.state==='approved'))throw new Error('Liga desconocida: descubrir y aprobar primero')
      const date=gameDate(u.searchParams.get('date')||undefined)
      const provider=sport==='baseball'&&league==='mlb'&&sourceAuthorization('mlb')?'mlb':'espn'
      const result=await measured(provider,()=>fetchGames({sport,league,date}))
      return json(res,200,{ok:true,...result,date})
    }
    if(path==='/api/odds'&&req.method==='GET'){
      const sportKey=u.searchParams.get('sportKey')||'baseball_mlb'
      const region=u.searchParams.get('region')||'us'
      const markets=u.searchParams.get('markets')||'h2h'
      const odds=await measured('the-odds-api',()=>fetchOdds(sportKey,{region,markets}))
      return json(res,200,{ok:true,odds,source:'the-odds-api',observedAt:new Date().toISOString()})
    }
    if(path==='/api/discover'&&req.method==='POST'){
      const body=await bodyJSON(req)
      if(body.source!=='espn'&&body.source!=='the-odds-api')throw new Error('Origen no compatible')
      const candidates=body.source==='espn'
        ? await measured('espn',()=>discoverLeagues(body.sport))
        : await measured('the-odds-api',()=>discoverOddsSports())
      const existing=new Set(state.candidates.map(x=>[x.source,x.sport||'',x.league||x.key].join('|')))
      for(const c of candidates){
        const key=[c.source,c.sport||'',c.league||c.key].join('|')
        if(!existing.has(key)){state.candidates.push(c);existing.add(key)}
      }
      state.candidates=state.candidates.slice(-1500)
      await saveState()
      return json(res,200,{ok:true,discovered:candidates.length,candidates:candidates.slice(0,300)})
    }
    if(path==='/api/approve-league'&&req.method==='POST'){
      const body=await bodyJSON(req)
      if(!validSport(body.sport)||!validLeague(body.league))throw new Error('Identificador inválido')
      const row=state.candidates.find(c=>c.source==='espn'&&c.sport===body.sport&&c.league===body.league)
      if(!row)throw new Error('La liga no fue descubierta mediante un proveedor autorizado')
      row.state='approved';row.approvedAt=new Date().toISOString()
      await saveState()
      return json(res,200,{ok:true,league:row.league,state:row.state})
    }
    if(path==='/api/review-source'&&req.method==='POST'){
      const body=await bodyJSON(req)
      if(!SOURCES.some(s=>s.id===body.id)||body.action!=='restore')throw new Error('Revisión no válida')
      const row=state.observations[body.id]||emptySourceRecord(body.id)
      row.quarantined=false;row.consecutiveFailures=0
      state.observations[body.id]=row
      await saveState()
      return json(res,200,{ok:true,id:body.id,status:'under-review'})
    }
    if(path==='/api/ticket'&&req.method==='POST'){
      const body=await bodyJSON(req)
      return json(res,200,{ok:true,ticket:quoteTicket(body.legs,{stake:body.stake})})
    }
    if(path==='/api/mlb/roster'&&req.method==='GET'){
      if(!sourceAuthorization('mlb'))throw new Error('MLB no autorizado')
      const team=Number(u.searchParams.get('team'))
      if(!Number.isSafeInteger(team)||team<1||team>99999)throw new Error('Equipo inválido')
      const data=await measured('mlb',()=>getJSON('https://statsapi.mlb.com/api/v1/teams/'+team+'/roster?rosterType=active'))
      const pitchers=(data.roster||[]).filter(p=>p.position?.type==='Pitcher'||p.position?.abbreviation==='P').map(p=>({id:p.person.id,name:p.person.fullName,position:p.position?.name,headshot:null}))
      return json(res,200,{ok:true,team,pitchers,source:'mlb'})
    }
    if(path==='/api/mlb/pitcher'&&req.method==='GET'){
      if(!sourceAuthorization('mlb'))throw new Error('MLB no autorizado')
      const id=Number(u.searchParams.get('id')),season=Number(u.searchParams.get('season')||new Date().getUTCFullYear())
      if(!Number.isSafeInteger(id)||id<1||id>99999999||!Number.isSafeInteger(season)||season<1871||season>2100)throw new Error('Deportista/año inválido')
      const url='https://statsapi.mlb.com/api/v1/people/'+id+'/stats?stats=season&group=pitching&season='+season
      const data=await measured('mlb',()=>getJSON(url))
      return json(res,200,{ok:true,id,season,statistics:data.stats||[],source:'mlb'})
    }
    json(res,404,{ok:false,error:'Ruta no encontrada'})
  }catch(e){json(res,400,{ok:false,error:String(e.message||e).replace(/apiKey=[^&\s]+/giu,'apiKey=[redacted]')})}
}
export async function startStudio({port=PORT}={}){
  await loadState()
  const server=createServer((req,res)=>void handler(req,res))
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)})
  return server
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  startStudio().then(()=>process.stdout.write('Phoenix Sports Studio: http://127.0.0.1:'+PORT+'\n'),e=>{process.stderr.write(e.message+'\n');process.exitCode=1})
}
