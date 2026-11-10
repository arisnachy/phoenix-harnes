/** Host-only sports provider API key lifecycle for Settings -> Conectores.
 * Keys travel exclusively through a trusted user-owned Remote form, never via
 * Kira prompts, Ask answers, settings JSON, telemetry or connector listings.
 */
import type {Context} from '@phoenix-ai/cordis'
import {credentialRef} from '@phoenix-ai/dsh-credentials'
import {verifyTheOddsApiKey} from './odds-api-connector.ts'
import type {SportsApiKeyId,SportsApiKeyState} from './types.ts'

type Provider={id:SportsApiKeyId;name:string;signup:string;purpose:string}
export const SPORTS_API_PROVIDERS:readonly Provider[]=[
  {id:'THE_ODDS_API_KEY',name:'The Odds API v4',signup:'https://the-odds-api.com/',purpose:'Cuotas NBA, NHL, NFL, MLB y fútbol'},
  {id:'THEODDSAPI_API_KEY',name:'TheOddsAPI',signup:'https://theoddsapi.com/pricing',purpose:'Cuotas multideporte independientes'},
  {id:'THERUNDOWN_API_KEY',name:'TheRundown',signup:'https://therundown.io/',purpose:'Cuotas de casas con plan gratuito limitado'},
  {id:'SPORTSGAMEODDS_API_KEY',name:'SportsGameOdds',signup:'https://sportsgameodds.com/docs/basics/setup',purpose:'Mercados y precios de casas'},
  {id:'PHOENIX_API_FOOTBALL_KEY',name:'API-Football',signup:'https://www.api-football.com/',purpose:'Calendarios y estadísticas de fútbol'},
  {id:'PHOENIX_API_HOCKEY_KEY',name:'API-Hockey',signup:'https://www.api-hockey.com/',purpose:'Calendarios y estadísticas de hockey'},
  {id:'PHOENIX_API_NFL_KEY',name:'API-NFL',signup:'https://www.api-american-football.com/',purpose:'Datos de fútbol americano'},
  {id:'PHOENIX_BALLDONTLIE_API_KEY',name:'balldontlie',signup:'https://www.balldontlie.io/',purpose:'Baloncesto y estadísticas'},
  {id:'PHOENIX_BIGBALLS_API_KEY',name:'Big Balls NHL',signup:'https://www.bigdataball.com/',purpose:'Datos complementarios NHL; licencia necesaria'},
  {id:'PHOENIX_NFLMETA_KEY',name:'NFLMeta',signup:'https://nflverse.nflverse.com/',purpose:'Datos NFL; cobertura según proveedor'},
  {id:'PHOENIX_SPORTMONKS_KEY',name:'Sportmonks',signup:'https://www.sportmonks.com/',purpose:'Estadísticas y fútbol según plan'},
]

type Vault={
  describe(ref:string):Promise<{configured:boolean;writable:boolean;source?:string}>
  resolve(ref:string):Promise<{value:string}|undefined>
  set(ref:string,value:string):Promise<void>
  unset(ref:string):Promise<void>
}
const getVault=(ctx:Context):Vault|undefined=>{
  try{return (ctx.get as (name:string)=>unknown)('credentials') as Vault|undefined}
  catch{return undefined}
}
const providerFor=(id:string):Provider=>{
  const found=SPORTS_API_PROVIDERS.find(row=>row.id===id)
  if(!found)throw Error('Proveedor deportivo no admitido')
  return found
}
const publicStatus=(provider:Provider,configured:boolean,source:SportsApiKeyState['source'],
  writable:boolean,status:SportsApiKeyState['status']):SportsApiKeyState=>({
  ...provider,configured,source,writable,status,verified:false,
})
/** Metadata-only list. Never resolves or returns a key. */
export async function sportsApiKeyStates(ctx:Context):Promise<SportsApiKeyState[]>{
  const vault=getVault(ctx)
  return Promise.all(SPORTS_API_PROVIDERS.map(async p=>{
    if(!vault)return publicStatus(p,false,'none',false,'vault-unavailable')
    let info:{configured:boolean;writable:boolean;source?:string}
    try{info=await vault.describe(credentialRef(p.id))}
    catch{return publicStatus(p,false,'none',false,'vault-unavailable')}
    const ambient=!!process.env[p.id]?.trim()
    const configured=info.configured||ambient
    const source:SportsApiKeyState['source']=info.configured?
      (info.source==='env'?'environment':'vault'):ambient?'environment':'none'
    return publicStatus(p,configured,source,info.writable,
      !configured?'missing-key':'configured-unverified')
  }))
}
/** Save only an allowlisted key to the existing Host vault. No raw key is returned. */
export async function saveSportsApiKey(ctx:Context,id:string,rawKey:string,
  request:typeof fetch=fetch):Promise<SportsApiKeyState>{
  const provider=providerFor(id)
  const vault=getVault(ctx)
  if(!vault)throw Error('Bóveda de credenciales no disponible')
  const key=rawKey.trim()
  if(key.length<8||key.length>512||/\s|[\x00-\x1f\x7f]/u.test(key))
    throw Error('Formato de API key inválido; verifica el valor con el proveedor')
  const before=await vault.describe(credentialRef(provider.id))
  if(!before.writable)throw Error('Credencial administrada fuera de PHOENIX; cambia su origen primero')
  if(provider.id==='THE_ODDS_API_KEY'){
    const verified=await verifyTheOddsApiKey(key,request)
    if(verified.status==='invalid-key')throw Error('El proveedor rechazó la clave; se conserva la anterior')
    await vault.set(credentialRef(provider.id),key)
    return {...publicStatus(provider,true,'vault',true,
      verified.status==='ready'?'ready':verified.status==='rate-limited'?
        'rate-limited':'unreachable'),verified:verified.verified}
  }
  await vault.set(credentialRef(provider.id),key)
  return publicStatus(provider,true,'vault',true,'configured-unverified')
}
/** Deletes only vault-owned keys; an environment key remains read-only. */
export async function removeSportsApiKey(ctx:Context,id:string):Promise<SportsApiKeyState>{
  const provider=providerFor(id)
  const vault=getVault(ctx)
  if(!vault)throw Error('Bóveda de credenciales no disponible')
  const info=await vault.describe(credentialRef(provider.id))
  if(!info.writable)throw Error('La clave proviene del entorno y es de solo lectura')
  await vault.unset(credentialRef(provider.id))
  const states=await sportsApiKeyStates(ctx)
  return states.find(row=>row.id===provider.id)!
}
/** A bounded manual verification for providers whose key probe is implemented. */
export async function verifySportsApiKey(ctx:Context,id:string,request:typeof fetch=fetch):Promise<SportsApiKeyState>{
  const provider=providerFor(id)
  const vault=getVault(ctx)
  if(!vault)throw Error('Bóveda de credenciales no disponible')
  if(id!=='THE_ODDS_API_KEY'){
    const state=(await sportsApiKeyStates(ctx)).find(x=>x.id===id)!
    return state
  }
  const saved=await vault.resolve(credentialRef(provider.id))
  if(!saved?.value)return publicStatus(provider,false,'none',true,'missing-key')
  const result=await verifyTheOddsApiKey(saved.value,request)
  return {...publicStatus(provider,true,saved.value===process.env[id]?'environment':'vault',
    true,result.status==='ready'?'ready':result.status==='invalid-key'?'invalid-key':
      result.status==='rate-limited'?'rate-limited':'unreachable'),verified:result.verified}
}
