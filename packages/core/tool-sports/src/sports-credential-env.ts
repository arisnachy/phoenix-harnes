/** Resolve credentials for sports tools per request without exposing the secret.
 * This is the Host vault's authoritative key, not the TheOddsAPI (no hyphen) key.
 */
import type {Context} from '@phoenix-ai/cordis'
/** Merge one trusted v4 provider credential into a private per-call environment.
 * @param ctx - Kira's host context (may not expose the optional credentials provider).
 * @param env - Existing nonsecret configuration and ambient environment.
 * @returns Private per-operation environment copy when vault has a key.
 */
export async function sportsEnvWithVaultKey(ctx:Context,env:NodeJS.ProcessEnv):Promise<NodeJS.ProcessEnv>{
  let vault: {resolve(ref:string):Promise<{value:string}|undefined>}|undefined
  try{
    vault=(ctx.get as (name:string)=>unknown)('credentials') as typeof vault
  }catch{return env}
  if(vault===undefined)return env
  try{
    const saved=await vault.resolve('THE_ODDS_API_KEY')
    if(typeof saved?.value==='string'&&saved.value.trim())return{...env,THE_ODDS_API_KEY:saved.value}
  }catch{/* An unavailable vault must never interrupt free ESPN queries. */}
  return env
}
