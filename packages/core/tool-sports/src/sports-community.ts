/** Public OddsPortal community opinions through installed OddsHarvester.
 * Community votes are sentiment, NOT a calibrated model probability.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { keylessEnabled } from './keyless-odds.ts'
const runFile=promisify(execFile)
export type CommunityOpinion={
  home:string;away:string;sport:string;league:string;market:string;source:'OddsPortal Community'
  observedAt:string;votes:Array<{selection:string;percentage:number}>
  limitation:'votación pública, no probabilidad predictiva'
}
const str=(v:unknown,n=110)=>typeof v==='string'?v.trim().slice(0,n):''
export function normalizeCommunity(input:unknown,now=Date.now(),maxAgeMs=12*60*60_000):CommunityOpinion[]{
  if(!Array.isArray(input))throw Error('Formato de comunidad no válido')
  const opinions:CommunityOpinion[]=[]
  for(const value of input.slice(0,40)){
    if(!value||typeof value!=='object'||Array.isArray(value))continue
    const v=value as Record<string,unknown>
    const at=Date.parse(str(v.scraped_at,60))
    if(!Number.isFinite(at)||at>now+60_000||now-at>maxAgeMs)continue
    const home=str(v.home_team),away=str(v.away_team),sport=str(v.sport),market=str(v.market)
    const league=str(v.league)
    if(!home||!away||!sport||!market||!Array.isArray(v.community_votes_pct))continue
    const votes=v.community_votes_pct.slice(0,4).flatMap(item=>{
      if(!item||typeof item!=='object')return []
      const row=item as Record<string,unknown>
      const pct=Number(row.pct),selection=str(row.outcome,35)
      return Number.isFinite(pct)&&pct>=0&&pct<=100&&selection?[{selection,percentage:pct}]:[]
    })
    if(!votes.length)continue
    opinions.push({home,away,sport,league,market,source:'OddsPortal Community',
      observedAt:new Date(at).toISOString(),votes,limitation:'votación pública, no probabilidad predictiva'})
  }
  return opinions
}
export async function communityOpinions(sport:string,env:NodeJS.ProcessEnv=process.env,
  runner?:()=>Promise<unknown>):Promise<CommunityOpinion[]>{
  if(!/^[a-z][a-z-]{2,32}$/u.test(sport))throw Error('Deporte de comunidad inválido')
  if(!keylessEnabled(env))throw Error('Proveedor comunitario sin clave no habilitado')
  let raw:unknown
  if(runner){
    raw=await runner()
  }else{
    const folder=await mkdtemp(join(tmpdir(),'phoenix-community-'))
    const file=join(folder,'picks.json')
    try{
      await runFile(env.PHOENIX_SPORTS_ODDSHARVESTER_BIN||'oddsharvester',
        ['community','-s',sport,'--headless','-f','json','-o',file],{
          shell:false,windowsHide:true,timeout:120_000,maxBuffer:256_000,env:process.env})
      if((await stat(file)).size>2_000_000)throw Error('Archivo comunitario demasiado grande')
      raw=JSON.parse(await readFile(file,'utf8')) as unknown
    }finally{await rm(folder,{recursive:true,force:true})}
  }
  return normalizeCommunity(raw)
}
