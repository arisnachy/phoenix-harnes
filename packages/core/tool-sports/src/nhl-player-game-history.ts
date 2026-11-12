/** Official NHL (NHL ID namespace) current-season game log.
 * These are observed completed regular-season games, not inferred starters.
 */
export type NhlGameHistory={
  eventId:string;date:string;opponent:string;venue:'home'|'away'|'unknown';
  stats:Record<string,number>;summary:string
}
export type NhlGameSplits={
  home:{games:number;averages:Record<string,number>}|null;
  away:{games:number;averages:Record<string,number>}|null;
}
type Obj=Record<string,unknown>
const obj=(x:unknown):Obj=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Obj:{}
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const text=(x:unknown,n=90):string=>(typeof x==='string'||typeof x==='number')?
  String(x).replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,n):''
const numeric=(value:unknown):number|null=>{
  if(typeof value!=='number'&&typeof value!=='string')return null
  if(typeof value==='string'&&!value.trim())return null
  const n=Number(value)
  return Number.isFinite(n)&&n>=-100_000&&n<=100_000?n:null
}
const METRICS=['goals','assists','points','shots','shotsAgainst','saves',
  'goalsAgainst','savePctg','shootingPctg','timeOnIce','plusMinus'] as const
export function parseNhlSeasonGameLog(
  raw:unknown,cutoff=Date.now(),maxGames=20,
):{games:NhlGameHistory[];splits:NhlGameSplits}{
  const root=obj(raw),found=new Map<string,NhlGameHistory>()
  for(const item of arr(root.gameLog).slice(0,95)){
    const row=obj(item),eid=text(row.gameId??row.id,20)
    const stamp=Date.parse(text(row.gameDate??row.date,45))
    if(!/^\d{1,20}$/u.test(eid)||!Number.isFinite(stamp)||stamp>=cutoff)continue
    const venueRaw=text(row.homeRoadFlag??row.homeAway,15).toUpperCase()
    const venue:NhlGameHistory['venue']=['H','HOME'].includes(venueRaw)?'home':
      ['R','A','AWAY','ROAD'].includes(venueRaw)?'away':'unknown'
    const stats:Record<string,number>={}
    for(const metric of METRICS){
      const value=numeric(row[metric])
      if(value!==null)stats[metric]=value
    }
    if(!Object.keys(stats).length)continue
    const date=new Date(stamp).toISOString().slice(0,10)
    const opponent=text(row.opponentAbbrev??obj(row.opponent).abbrev,16)
    const summary=Object.entries(stats).slice(0,9).map(([k,v])=>k+': '+v)
      .join(' · ').slice(0,380)
    found.set(eid,{eventId:eid,date,opponent,venue,stats,summary})
  }
  const all=[...found.values()].sort((a,b)=>b.date.localeCompare(a.date)||
    b.eventId.localeCompare(a.eventId))
  const games=all.slice(0,Math.max(1,Math.min(20,maxGames)))
  // Split averages are calculated ONLY from explicit per-game home/road flags.
  // 'unknown' games are omitted; never infer team venue from opponent.
  const side=(venue:'home'|'away')=>{
    const rows=games.filter(g=>g.venue===venue)
    if(!rows.length)return null
    const averages:Record<string,number>={}
    for(const metric of METRICS){
      const nums=rows.flatMap(g=>g.stats[metric]===undefined?[]:[g.stats[metric]!])
      if(nums.length)averages[metric]=Number(
        (nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(3))
    }
    return{games:rows.length,averages}
  }
  return{games,splits:{home:side('home'),away:side('away')}}
}
