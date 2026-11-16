/** NHL goalie evidence from strictly pre-kickoff official player game logs.
 * Appearance != confirmed start; no weighted save percentage is a win model.
 */
import type {HockeyPlayer} from './nhl-evidence-research.ts'
export type NhlGoalieForm={
  playerId:string;name:string;team:string;idProvider:'NHL'|'ESPN'|'unknown'
  lastAppearance:string|null;recentGames:number;shotsAgainst:number|null
  saves:number|null;recentSavePct:number|null
  seasonSavePct:number|null;source:'NHL game-log'|'NHL player landing'|'unavailable'
  confirmedStarter:false
}
const finite=(n:unknown):n is number=>typeof n==='number'&&
  Number.isFinite(n)&&n>=0
const rawPct=(n:unknown):number|null=>{
  const value=typeof n==='string'||typeof n==='number'?Number(n):NaN
  if(!Number.isFinite(value)||value<0)return null
  const v=value>1?value/100:value
  return v<=1?Number(v.toFixed(4)):null
}
/** Uses each hockey player's dated game-log only; never assumes listed starter. */
export function nhlGoalieEvidence(
  goalies:readonly HockeyPlayer[],kickoff:string,
):NhlGoalieForm[]{
  const cutoff=Date.parse(kickoff)
  return goalies.map(player=>{
    const safe=(player.last20??[]).filter(g=>{
      const t=Date.parse(g.date+'T12:00:00Z')
      return Number.isFinite(cutoff)&&Number.isFinite(t)&&t<cutoff
    }).slice(0,5)
    const valid=safe.filter(g=>finite(g.stats.shotsAgainst)&&
      finite(g.stats.saves)&&g.stats.shotsAgainst>0&&
      g.stats.saves<=g.stats.shotsAgainst)
    const shots=valid.reduce((n,g)=>n+g.stats.shotsAgainst!,0)
    const saves=valid.reduce((n,g)=>n+g.stats.saves!,0)
    const recentlyObserved=valid.length>0&&shots>0
    const provider=player.idProvider??'unknown'
    const seasonSavePct=rawPct(player.stats.savePctg)
    return{
      playerId:player.id,name:player.name,team:player.team,
      idProvider:provider,lastAppearance:safe[0]?.date??null,
      recentGames:safe.length,
      shotsAgainst:recentlyObserved?shots:null,
      saves:recentlyObserved?saves:null,
      recentSavePct:recentlyObserved?Number((saves/shots).toFixed(4)):null,
      seasonSavePct,
      source:safe.length?'NHL game-log' as const:
        seasonSavePct!==null?'NHL player landing' as const:'unavailable' as const,
      confirmedStarter:false as const,
    }
  })
}
