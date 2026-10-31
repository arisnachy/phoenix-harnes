/** The Odds API (hyphenated domain) credential lifecycle for Settings → Conectores.
 * Secret never enters catalog, telemetry, model answers or stored connector configs.
 */
import type {Context} from '@phoenix-ai/cordis'
import type {OddsApiConnectorState} from './types.ts'
import {credentialRef,type CredentialRef} from '@phoenix-ai/dsh-credentials'

export const THE_ODDS_API_CREDENTIAL='THE_ODDS_API_KEY' as const
const ENDPOINT='https://api.the-odds-api.com/v4/sports/'
const KEY_FORMAT=/^[A-Za-z0-9_-]{16,128}$/u

type Credentials={
  resolve(ref:CredentialRef):Promise<{value:string}|undefined>
  set(ref:CredentialRef,value:string):Promise<void>
  unset(ref:CredentialRef):Promise<void>
}
const credentials=(ctx:Context):Credentials|undefined=>
  (ctx.get as (name:string)=>unknown)('credentials') as Credentials|undefined

function safeQuota(response:Response):Pick<OddsApiConnectorState,'requestsRemaining'|'requestsUsed'|'lastRequestCost'>{
  const num=(key:string)=>{
    const text=response.headers?.get(key)
    if(text===null||text===undefined||!/^[0-9]{1,12}$/u.test(text))return undefined
    const value=Number(text)
    return Number.isSafeInteger(value)?value:undefined
  }
  const remaining=num('x-requests-remaining'),used=num('x-requests-used'),last=num('x-requests-last')
  return {...(remaining===undefined?{}:{requestsRemaining:remaining}),
    ...(used===undefined?{}:{requestsUsed:used}),
    ...(last===undefined?{}:{lastRequestCost:last})}
}
/** Verify against the provider's zero-credit /v4/sports endpoint, no odds requests.
 * @param apiKey - Credential used ONLY on the pinned official HTTPS host.
 * @param request - Injectable HTTPS transport for tests.
 * @returns Sanitized health and optional quota; never the secret or raw URL.
 */
export async function verifyTheOddsApiKey(
  apiKey:string,request:typeof fetch=fetch,
):Promise<Pick<OddsApiConnectorState,'status'|'verified'|'requestsRemaining'|'requestsUsed'|'lastRequestCost'>>{
  if(!KEY_FORMAT.test(apiKey))return{status:'invalid-key',verified:false}
  const url=new URL(ENDPOINT)
  url.searchParams.set('apiKey',apiKey)
  try{
    const response=await request(url.toString(),{
      method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10_000),
      headers:{accept:'application/json'},
    })
    const quota=safeQuota(response)
    if(response.status===401||response.status===403)return{status:'invalid-key',verified:false,...quota}
    if(response.status===429)return{status:'rate-limited',verified:false,...quota}
    if(!response.ok)return{status:'unreachable',verified:false,...quota}
    const body:unknown=await response.json()
    if(!Array.isArray(body))return{status:'unreachable',verified:false,...quota}
    return{status:'ready',verified:true,...quota}
  }catch{
    // Never expose a network error object: it may contain the URL with apiKey.
    return{status:'unreachable',verified:false}
  }
}
/** Report credential provenance and check the provider; secret-free. */
export async function theOddsApiConnectorState(
  ctx:Context,request:typeof fetch=fetch,
):Promise<OddsApiConnectorState>{
  const vault=credentials(ctx)
  if(vault===undefined)return{configured:false,verified:false,source:'none',status:'vault-unavailable'}
  const stored=await vault.resolve(credentialRef(THE_ODDS_API_CREDENTIAL))
  const source=stored?.value?'vault':process.env.THE_ODDS_API_KEY?.trim()?'environment':'none'
  const key=stored?.value??process.env.THE_ODDS_API_KEY?.trim()
  if(!key)return{configured:false,verified:false,source:'none',status:'unconfigured'}
  return{configured:true,source,...await verifyTheOddsApiKey(key,request)}
}
/** Save key in the Host's durable credential vault, never settings JSON.
 * Invalid keys are not persisted; network outages preserve the key as unverified.
 */
export async function configureTheOddsApiConnector(
  ctx:Context,rawKey:string,request:typeof fetch=fetch,
):Promise<OddsApiConnectorState>{
  const vault=credentials(ctx)
  if(vault===undefined)throw Error('El vault seguro de PHOENIX no está disponible.')
  if(typeof rawKey!=='string'||!KEY_FORMAT.test(rawKey.trim()))
    throw Error('La API key debe contener entre 16 y 128 caracteres alfanuméricos, guiones o guion bajo.')
  const key=rawKey.trim()
  const checked=await verifyTheOddsApiKey(key,request)
  if(checked.status==='invalid-key')
    throw Error('The Odds API rechazó la clave. No se sustituyó la credencial anterior.')
  await vault.set(credentialRef(THE_ODDS_API_CREDENTIAL),key)
  return{configured:true,source:'vault',...checked}
}
/** Remove only the Host-stored key, never modify user environment variables. */
export async function disconnectTheOddsApiConnector(
  ctx:Context,request:typeof fetch=fetch,
):Promise<OddsApiConnectorState>{
  const vault=credentials(ctx)
  if(vault===undefined)throw Error('El vault seguro de PHOENIX no está disponible.')
  await vault.unset(credentialRef(THE_ODDS_API_CREDENTIAL))
  return theOddsApiConnectorState(ctx,request)
}
