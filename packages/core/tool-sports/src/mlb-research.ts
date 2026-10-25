/** Phoenix evidence-based MLB matchup trend; never a calibrated win-probability. */
import {getFeed} from './sports.ts'
type Standing={team?:{id?:number};wins?:number;losses?:number;runsScored?:number;runsAllowed?:number;winningPercentage?:string}
type Standings={records?:Array<{teamRecords?:Standing[]}>}
export type ResearchTrend={favorite:string;method:string;source:string;evidence:string[]}
export async function researchMlbTrend(homeId:number,awayId:number,season:number,
  homeName:string,awayName:string,fetcher:typeof fetch=fetch):Promise<ResearchTrend|undefined>{
  if(!Number.isSafeInteger(homeId)||!Number.isSafeInteger(awayId)||homeId<1||awayId<1)return undefined
  if(!Number.isSafeInteger(season)||season<1871||season>2100)return undefined
  try{
    const feed=await getFeed<Standings>('https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season='+season,fetcher)
    const records=(feed.records||[]).flatMap(x=>x.teamRecords||[])
    const home=records.find(x=>x.team?.id===homeId),away=records.find(x=>x.team?.id===awayId)
    if(!home||!away)return undefined
    const winning=(v:Standing)=>Number(v.wins)/((v.wins||0)+(v.losses||0))
    const hw=winning(home),aw=winning(away)
    const diff=(v:Standing)=>(v.runsScored||0)-(v.runsAllowed||0)
    if(!Number.isFinite(hw)||!Number.isFinite(aw)||home.runsScored===undefined||away.runsScored===undefined
      ||home.runsAllowed===undefined||away.runsAllowed===undefined)return undefined
    const homeEdge=hw-aw,runEdge=diff(home)-diff(away)
    const favorite=homeEdge>.04&&runEdge>25?homeName:homeEdge<-.04&&runEdge< -25?awayName:'Sin favorito consistente'
    return {favorite,method:'Tendencia orientativa de Phoenix por temporada regular; no es una predicción calibrada ni un porcentaje de victoria.',
      evidence:[
        homeName+': '+home.wins+'-'+home.losses+' · diferencial de carreras '+(diff(home)>0?'+':'')+diff(home),
        awayName+': '+away.wins+'-'+away.losses+' · diferencial de carreras '+(diff(away)>0?'+':'')+diff(away),
      ],source:'MLB Stats API · clasificación de '+season}
  }catch{return undefined}
}
