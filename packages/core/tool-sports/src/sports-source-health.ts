/**
 * Provider readiness is NOT the same as a successful live bookmaker quotation.
 * Never return secret values or promote a historical odds archive to a live feed.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stat } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { keylessEnabled } from './keyless-odds.ts'

/** Rehydrate only locally verified, nonsecret paths from the managed install. */
export function hydrateSportsSources(env:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
  const next={...env}
  const root=resolve(env.PHOENIX_SPORTS_SOURCE_HOME?.trim()||join(homedir(),'.phoenix','sports-sources'))
  try{
    const value=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8')) as {
      schema?:number; paths?:{executable?:string;history?:string};
      components?:Record<string,{status?:string}>
    }
    if(value.schema!==2||!value.paths||!value.components)return next
    const inside=(path:string):boolean=>{
      const full=resolve(path),normalizedRoot=root.toLowerCase()
      return full.toLowerCase().startsWith(normalizedRoot+sep.toLowerCase())
    }
    const binary=value.paths.executable
    if(binary&&inside(binary)&&existsSync(binary)
      &&value.components['OddsHarvester + Playwright']?.status==='installed'){
      if(next.PHOENIX_SPORTS_ODDSHARVESTER_BIN===undefined)
        next.PHOENIX_SPORTS_ODDSHARVESTER_BIN=binary
      if(next.PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED===undefined)
        next.PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED='1'
    }
    const history=value.paths.history
    if(history&&inside(history)&&existsSync(join(history,'sportsbookreview-nhl.json'))
      &&value.components['SportsbookReview NFL/NBA/NHL/MLB archive']?.status==='installed'){
      if(next.PHOENIX_SPORTS_HISTORY_DIR===undefined)next.PHOENIX_SPORTS_HISTORY_DIR=history
    }
  }catch{/* installation not yet complete: old Phoenix runtime stays safe */}
  return next
}

export type ManagedSportsInstall = {
  configured:boolean
  updatedAt:string|null
  logPath:string
  components:Array<{name:string;status:string;lastError:string|null}>
  state:'not-started'|'installing'|'partial'|'installed'|'failed'
  playwrightVerifiedAtInstall:boolean
}
/** Read install progress without executing a scraper, network requests or
 * exposing API credentials. The installer only marks Playwright installed
 * after verifying an actual Chromium executable.
 */
export function managedSportsInstallStatus(env:NodeJS.ProcessEnv=process.env):ManagedSportsInstall {
  const root=resolve(env.PHOENIX_SPORTS_SOURCE_HOME?.trim()||
    join(homedir(),'.phoenix','sports-sources'))
  const blank:ManagedSportsInstall={configured:false,updatedAt:null,
    logPath:join(root,'install.log'),components:[],state:'not-started',
    playwrightVerifiedAtInstall:false}
  try{
    const data=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8')) as {
      schema?:number;updatedAt?:string
      components?:Record<string,{status?:string;message?:string}>
    }
    if(data.schema!==2||!data.components)return blank
    const components=Object.entries(data.components).map(([name,row])=>({
      name,status:row.status??'unknown',lastError:row.status==='error'?
        String(row.message??'Error sin detalle').slice(0,180):null,
    }))
    const statuses=components.map(x=>x.status)
    const state=components.length===0?'not-started':
      statuses.some(x=>x==='installing')?'installing':
      statuses.every(x=>x==='installed')?'installed':
      statuses.some(x=>x==='installed')?'partial':'failed'
    return{configured:true,updatedAt:data.updatedAt??null,
      logPath:join(root,'install.log'),components,state,
      playwrightVerifiedAtInstall:components.some(x=>
        x.name==='OddsHarvester + Playwright'&&x.status==='installed')}
  }catch{return blank}
}
const run = promisify(execFile)
export type SportsSourceHealth = {
  provider:string
  purpose:'live-odds'|'historical-odds'|'event-data'
  status:'configured'|'disabled'|'missing-binary'|'missing-files'|'not-configured'|'installing'|'install-error'
  note:string
}
const exists = async(file:string):Promise<boolean>=>{
  try{return (await stat(file)).isFile()}catch{return false}
}
/**
 * Pure configuration truth + bounded local binary probe, no site requests.
 * Ready-to-run does not imply OddsPortal access or an active price.
 */
export async function sportsSourcesHealth(
  env:NodeJS.ProcessEnv=process.env,
  probe:(bin:string)=>Promise<boolean>=async bin=>{
    try{await run(bin,['--help'],{shell:false,windowsHide:true,timeout:6000,maxBuffer:256000});return true}
    catch{return false}
  },
  fileExists:(file:string)=>Promise<boolean>=exists,
):Promise<SportsSourceHealth[]>{
  const live:SportsSourceHealth[]=[]
  const managed=managedSportsInstallStatus(env)
  const oddsStep=managed.components.find(x=>x.name==='OddsHarvester + Playwright')
  const sbrStep=managed.components.find(x=>x.name.startsWith('SportsbookReview NFL'))
  const mlbStep=managed.components.find(x=>x.name.startsWith('MLB historic'))
  live.push({provider:'ESPN Site/Core',purpose:'event-data',
    status:env.PHOENIX_SPORTS_ESPN_DISABLED==='1'?'disabled':'configured',
    note:'Marcadores y, solo si ESPN publica líneas recientes, cuotas; no es una casa de apuestas.'})
  if(keylessEnabled(env)){
    const bin=env.PHOENIX_SPORTS_ODDSHARVESTER_BIN?.trim()||'oddsharvester'
    const found=await probe(bin)
    live.push({provider:'jordantete/OddsHarvester',purpose:'live-odds',
      status:found?'configured':'missing-binary',
      note:found?'CLI disponible; aún falta comprobar cuotas reales y acceso a OddsPortal.':
        'CLI no ejecutable. Instala oddsharvester y Playwright Chromium en el Windows que ejecuta PHOENIX.'})
  }else live.push({provider:'jordantete/OddsHarvester',purpose:'live-odds',
    status:oddsStep?.status==='installing'?'installing':
      oddsStep?.status==='error'?'install-error':'disabled',
    note:(oddsStep?.status==='error'?'Error del instalador: '+oddsStep.lastError+'; ':
      oddsStep?.status==='installing'?'Instalación en curso; ':
        oddsStep?.status==='installed'?'CLI instalada; comprobación de acceso a OddsPortal pendiente; ':'')+
      'PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED no está activado; NO se ejecutó scraping. '+
      'Comprueba sports_chat_sources_health e install.log.'})
  live.push({provider:'The Odds API v4',purpose:'live-odds',
    status:env.THE_ODDS_API_KEY?.trim()?'configured':'not-configured',
    note:'La clave configurada no demuestra acceso, cuota vigente ni cobertura de ligas.'})
  live.push({provider:'TheOddsAPI',purpose:'live-odds',
    status:env.THEODDSAPI_API_KEY?.trim()?'configured':'not-configured',
    note:'Proveedor opcional distinto de The Odds API v4; acceso y cuota por comprobar.'})
  const folder=env.PHOENIX_SPORTS_HISTORY_DIR?.trim()??''
  const configured=folder!==''&&isAbsolute(folder)
  const sbr=configured?await Promise.all(['nba','nfl','nhl','mlb'].map(
    sport=>fileExists(join(folder,'sportsbookreview-'+sport+'.json')))):[]
  const mlb=configured&&await fileExists(join(folder,'mlb-odds.json'))
  live.push({provider:'flancast90/sportsbookreview-scraper',purpose:'historical-odds',
    status:!configured?(sbrStep?.status==='installing'?'installing':
      sbrStep?.status==='error'?'install-error':'not-configured'):
      sbr.every(Boolean)?'configured':'missing-files',
    note:!configured?'PHOENIX_SPORTS_HISTORY_DIR sin ruta absoluta; el motor no descargó su histórico.':
      'Archivos presentes: '+sbr.filter(Boolean).length+'/4; solo históricos, no cotizaciones actuales.'})
  live.push({provider:'ArnavSaraogi/mlb-odds-scraper',purpose:'historical-odds',
    status:!configured?(mlbStep?.status==='installing'?'installing':
      mlbStep?.status==='error'?'install-error':'not-configured'):
      mlb?'configured':'missing-files',
    note:!configured?'PHOENIX_SPORTS_HISTORY_DIR sin ruta absoluta; el motor no descargó su histórico.':
      mlb?'Archivo histórico MLB encontrado; contenido y actualidad no verificados.':
        'Falta mlb-odds.json; no hay histórico MLB importado.'})
  return live
}
