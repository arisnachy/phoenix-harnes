/** NHL official club-stats priority for *research order*, not confirmed lines.
 * Work only with player IDs present in the verified same-club roster.
 * Season points and ice time are descriptive, not player availability or EV.
 */
import type {HockeyPlayer} from './nhl-evidence-research.ts'
export type NhlSkaterImpact={
  playerId:string;name:string;role:'forward'|'defense';
  gamesPlayed:number;goals:number;assists:number;points:number;
  shots:number;avgTimeOnIcePerGame:number|null
}
const obj=(x:unknown):Record<string,unknown>=>x&&typeof x==='object'&&!Array.isArray(x)?
  x as Record<string,unknown>:{}
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const num=(x:unknown):number|null=>{
  if(typeof x!=='number'&&typeof x!=='string')return null
  if(typeof x==='string'&&!x.trim())return null
  const n=Number(x)
  return Number.isFinite(n)&&n>=0&&n<100000?n:null
}
/** Source shape: /v1/club-stats/{team}/{season}/2, validated per NHL ID. */
export function prioritizeNhlSkaters(
  roster:readonly HockeyPlayer[],payload:unknown,
):{ranked:HockeyPlayer[];leaders:NhlSkaterImpact[];matched:number}{
  const stats=arr(obj(payload).skaters).map(obj)
  const byId=new Map(stats.flatMap(item=>{
    const id=String(item.playerId??'')
    const points=num(item.points),gamesPlayed=num(item.gamesPlayed)
    if(!/^\d{1,18}$/u.test(id)||points===null||gamesPlayed===null)return[]
    const goals=num(item.goals)??0,assists=num(item.assists)??0
    return[[id,{points,gamesPlayed,goals,assists,
      shots:num(item.shots)??0,
      avgTimeOnIcePerGame:num(item.avgTimeOnIcePerGame)}] as const]
  }))
  const rosterIds=new Set(roster.filter(p=>p.idProvider==='NHL'&&
    p.role!=='goalie').map(p=>p.id))
  const leaders: NhlSkaterImpact[]=[]
  for(const p of roster){
    if(!rosterIds.has(p.id))continue
    const record=byId.get(p.id)
    if(!record)continue
    leaders.push({
      playerId:p.id,name:p.name,role:p.role==='defense'?'defense':'forward',
      ...record,
    })
  }
  leaders.sort((a,b)=>b.points-a.points||
    (b.avgTimeOnIcePerGame??0)-(a.avgTimeOnIcePerGame??0)||
    b.shots-a.shots||a.playerId.localeCompare(b.playerId))
  const order=new Map(leaders.map((p,i)=>[p.playerId,i]))
  const ranked=[...roster].sort((a,b)=>{
    const ai=order.get(a.id),bi=order.get(b.id)
    return ai===undefined&&bi===undefined?0:
      ai===undefined?1:bi===undefined?-1:ai-bi
  })
  return{ranked,leaders,matched:leaders.length}
}
