/** ESPN Common v3 athlete gamelogs and situational splits.
 * Parse event/category shapes independently of season averages; never infer
 * a played game, opponent or venue from totals. Pure, bounded and testable.
 */
export type HistoryMetric={name:string;value:string}
type Row=Record<string,unknown>
const obj=(x:unknown):Row=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Row:{}
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const word=(x:unknown,n=100):string=>(typeof x==='string'||typeof x==='number')?
  String(x).replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,n):''
const eventId=(x:unknown):string=>/^\d{1,18}$/u.test(String(x??''))?String(x):''
const date=(x:unknown):number=>{
  const val=Date.parse(word(x,50));return Number.isFinite(val)?val:0
}
const matchedLabels=(node:Row,root:Row,count:number):string[]=>{
  for(const item of [node.labels,node.displayNames,node.names,root.labels,root.displayNames,root.names]){
    const labels=arr(item).map(x=>word(x,36))
    if(labels.length===count)return labels
    // Some ESPN views prepend date/opponent/result to the statistical columns.
    if(labels.length===count+3&&
      /^(date|fecha)$/iu.test(labels[0]??'')&&
      /^(opp|opponent|rival)$/iu.test(labels[1]??''))
      return labels.slice(3)
  }
  return []
}
type GameRow={id:string;stamp:number;name:string;stats:Map<string,string>}
const validValue=(v:unknown):string=>word(v,24)
function addGame(rows:Map<string,GameRow>,raw:unknown,headers:Row,root:Row,
  metadata:Row,now:number):void{
  const e=obj(raw),eid=eventId(e.eventId??e.id)
  const values=arr(e.stats??e.statistics)
  if(!eid||!values.length||rows.size>=180&&!rows.has(eid))return
  const labels=matchedLabels(headers,root,values.length)
  if(!labels.length)return
  const stamp=date(metadata.gameDate??metadata.date??e.gameDate??e.date)
  // Never count an upcoming match as an observed individual performance.
  if(stamp>now)return
  const opponent=obj(metadata.opponent??e.opponent)
  const against=word(opponent.abbreviation??opponent.displayName,32)
  const gameName=word(metadata.shortName??metadata.name??e.displayName,85)||
    [stamp?new Date(stamp).toISOString().slice(0,10):'',against?'vs '+against:''].filter(Boolean).join(' ')||
    'ESPN game '+eid
  let row=rows.get(eid)
  if(!row){row={id:eid,stamp,name:gameName,stats:new Map()};rows.set(eid,row)}
  if(stamp>row.stamp){row.stamp=stamp;row.name=gameName}
  for(let i=0;i<labels.length;i++){
    const label=labels[i]??'',value=validValue(values[i])
    if(label&&value&&!row.stats.has(label))row.stats.set(label,value)
  }
}
/** 20 most recent distinct event-level rows; source metadata stays attached. */
export function parseEspnGameLog(raw:unknown,now=Date.now(),limit=20):HistoryMetric[]{
  const root=obj(raw)
  const metadata=obj(root.events),rows=new Map<string,GameRow>()
  // ESPN returns both events: {id:metadata} and events: [{id,stats}].
  for(const item of arr(root.events).slice(0,180)){
    const e=obj(item);addGame(rows,item,root,root,e,now)
  }
  for(const season of arr(root.seasonTypes).slice(0,6)){
    const s=obj(season)
    for(const category of arr(s.categories).slice(0,18)){
      const c=obj(category)
      for(const item of arr(c.events).slice(0,110)){
        const e=obj(item),eid=eventId(e.eventId??e.id)
        const meta=obj(metadata[eid])
        addGame(rows,item,c,root,meta,now)
      }
    }
  }
  const result=[...rows.values()].filter(x=>x.stats.size>0)
    .sort((a,b)=>b.stamp-a.stamp||b.id.localeCompare(a.id))
  return result.slice(0,Math.max(1,Math.min(20,limit))).map(g=>({
    name:g.name,
    value:[...g.stats].slice(0,12).map(([k,v])=>k+': '+v).join(' · ').slice(0,380),
  }))
}
const categoryName=(node:Row):string=>word(node.displayName??node.name??
  node.abbreviation??node.label,55)
const scalar=(v:unknown):string=>{
  const a=obj(v)
  return word(Object.keys(a).length?(a.displayValue??a.value??a.total):v,35)
}
/** Situational split dimensions must survive: Home PTS != Away PTS.
 * Do not deduplicate by a bare stat label across split groups.
 */
export function parseEspnSplits(raw:unknown,limit=48):HistoryMetric[]{
  const root=obj(raw),out:HistoryMetric[]=[],used=new Set<string>()
  const max=Math.max(1,Math.min(limit,80))
  // Live ESPN Common v3 keeps labels at the ROOT, while Home/Road has
  // only a stats[] array of strings nested under splitCategories[].splits[].
  const rootLabels=arr(root.displayNames).length?arr(root.displayNames):
    arr(root.labels).length?arr(root.labels):arr(root.names)
  const queue:Array<{data:unknown;path:string;depth:number}>=[
    ...arr(root.categories).map(x=>({data:x,path:'',depth:0})),
    ...arr(root.splitCategories).map(x=>({data:x,path:'',depth:0})),
    ...arr(root.splits).map(x=>({data:x,path:'',depth:0})),
  ]
  if(!queue.length)queue.push({data:root,path:'',depth:0})
  let visited=0
  while(queue.length&&visited++<150&&out.length<max){
    const next=queue.shift()!,node=obj(next.data)
    const title=categoryName(node)
    const path=next.path?title?next.path+' · '+title:next.path:
      title||'Total'
    const values=arr(node.totals).length?arr(node.totals):
      arr(node.displayValues).length?arr(node.displayValues):
      arr(node.values).length?arr(node.values):
      // Numeric ESPN split rows use stats[]; the row objects below are
      // handled separately and are never treated as scalar statistics.
      arr(node.stats).every(x=>typeof x==='string'||typeof x==='number')?
        arr(node.stats):[]
    const labels=arr(node.labels).length===values.length&&values.length?arr(node.labels):
      arr(node.displayNames).length===values.length&&values.length?arr(node.displayNames):
      arr(node.names).length===values.length&&values.length?arr(node.names):
      rootLabels.length===values.length?rootLabels:[]
    if(labels.length&&labels.length===values.length){
      for(let i=0;i<labels.length&&out.length<max;i++){
        const stat=word(labels[i],45),value=scalar(values[i])
        const name=(path+' · '+stat).slice(0,110)
        if(stat&&value&&!used.has(name)){
          out.push({name,value});used.add(name)
        }
      }
    }
    // ESPN may expose individual named statistic objects instead of parallel
    // labels/totals, or nested per-situation splits.
    for(const row of arr(node.stats).slice(0,70)){
      const item=obj(row),metric=word(item.displayName??item.name??item.label,45)
      const value=scalar(item.displayValue??item.value)
      const name=(path+' · '+metric).slice(0,110)
      if(metric&&value&&!used.has(name)&&out.length<max){
        out.push({name,value});used.add(name)
      }
    }
    if(next.depth>=4)continue
    for(const key of ['splits','categories','splitCategories','items','statistics']){
      for(const child of arr(node[key]).slice(0,35))
        queue.push({data:child,path,depth:next.depth+1})
    }
  }
  return out
}
/** Official NHL player landing is a valid *different provider* for last5.
 * Do not equate NHL athlete IDs with ESPN athlete IDs or infer game starters.
 */
export function parseNhlLast5(raw:unknown,now=Date.now()):HistoryMetric[]{
  const root=obj(raw),games=arr(root.last5Games)
  const output:HistoryMetric[]=[]
  for(const value of games.slice(0,8)){
    const row=obj(value),stamp=date(row.gameDate??row.date)
    if(stamp>now)continue
    const game=word(row.gameDate??row.date,20)
    const opponent=word(row.opponentAbbrev??obj(row.opponent).abbrev,16)
    const pairs=['goals','assists','points','shots','saves','shotsAgainst',
      'savePctg','goalsAgainst','timeOnIce','decision'].flatMap(key=>{
      const v=scalar(row[key])
      return v?[key+': '+v]:[]
    })
    if(!game||!pairs.length)continue
    output.push({name:(game+(opponent?' vs '+opponent:'')).slice(0,90),
      value:pairs.slice(0,9).join(' · ').slice(0,370)})
  }
  return output.slice(0,5)
}
