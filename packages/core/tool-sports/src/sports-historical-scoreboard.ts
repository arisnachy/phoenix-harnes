/** ESPN stopped accepting date ranges on scoreboard in Sep 2026.
 * Query YYYYMM monthly instead, falling back to individually verified days.
 * Never create results, player stats or outcomes not supplied by ESPN.
 */
type Scoreboard={events?:unknown[]}
type Reader=(url:string)=>Promise<Scoreboard|null>
type Event={id?:string|number;date?:string}
const dayValid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(s)&&
  Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
  new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s
const asEvent=(v:unknown):Event=>v&&typeof v==='object'&&!Array.isArray(v)?v as Event:{}
const validBoard=(v:Scoreboard|null):v is {events:unknown[]}=>Array.isArray(v?.events)
export type HistoryAudit={
  events:unknown[];monthlyQueries:number;monthlySuccesses:number;dailyQueries:number;
  dailySuccesses:number;scheduleQueries:number;scheduleSuccesses:number;
  status:'verified'|'partial'|'unavailable';
  explanation:string
}
export async function readHistoricalScoreboard(root:string,start:string,end:string,
  read:Reader,teamIds:readonly string[]=[]):Promise<HistoryAudit>{
  const begin=Date.parse(start+'T00:00:00Z'),finish=Date.parse(end+'T00:00:00Z')
  if(!/^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/[a-z-]+\/[a-z0-9._-]+\/$/u.test(root)||
    !dayValid(start)||!dayValid(end)||begin>finish||(finish-begin)>61*86_400_000)
    throw Error('Historial ESPN: argumentos fuera de catálogo o ventana')
  const months:string[]=[]
  for(const dt=new Date(Date.UTC(Number(start.slice(0,4)),Number(start.slice(5,7))-1,1));
    dt.getTime()<=finish;dt.setUTCMonth(dt.getUTCMonth()+1))
    months.push(dt.toISOString().slice(0,7).replace('-',''))
  const results=new Map<string,unknown>()
  const result:HistoryAudit={events:[],monthlyQueries:months.length,monthlySuccesses:0,
    dailyQueries:0,dailySuccesses:0,scheduleQueries:0,scheduleSuccesses:0,
    status:'unavailable',explanation:''}
  const take=(items:unknown[])=>{
    for(const entry of items){
      const item=asEvent(entry),eventId=String(item.id??''),when=Date.parse(item.date??'')
      if(!/^\d{1,20}$/u.test(eventId)||!Number.isFinite(when)||
        when<begin-86_400_000||when>finish+2*86_400_000)continue
      results.set(eventId,entry)
    }
  }
  const load=async(url:string)=>{
    try{return await read(url)}catch{return null}
  }
  let completeMonths=0
  for(const month of months){
    const monthly=await load(root+'scoreboard?dates='+month+'&limit=500')
    if(validBoard(monthly)&&monthly.events.length<500){
      result.monthlySuccesses++;completeMonths++;take(monthly.events);continue
    }
    const year=Number(month.slice(0,4)),m=Number(month.slice(4,6))-1
    const lo=Math.max(begin,Date.UTC(year,m,1))
    const hi=Math.min(finish,Date.UTC(year,m+1,0))
    const days=Array.from({length:Math.floor((hi-lo)/86_400_000)+1},
      (_,i)=>new Date(lo+i*86_400_000).toISOString().slice(0,10))
    // Two boundary probes avoid a flood when ESPN as a whole is down.
    const probes=[...new Set([days[0],days[days.length-1]].filter((x):x is string=>!!x))]
    const fetchDay=async(day:string)=>{
      const board=await load(root+'scoreboard?dates='+day.replaceAll('-','')+'&limit=500')
      result.dailyQueries++
      if(validBoard(board)){result.dailySuccesses++;take(board.events);return true}
      return false
    }
    const checks=await Promise.all(probes.map(fetchDay))
    if(!checks.some(Boolean))continue
    const visited=new Set(probes),remaining=days.filter(day=>!visited.has(day))
    let index=0,successes=checks.filter(Boolean).length
    await Promise.all(Array.from({length:Math.min(4,remaining.length)},async()=>{
      while(index<remaining.length){
        const day=remaining[index++]!
        if(await fetchDay(day))successes++
      }
    }))
    if(successes===days.length)completeMonths++
  }
  // Independent ESPN team-schedule route after broken month/day responses.
  // A schedule is not a boxscore; only completed events with actual scores
  // will be counted later by each sport's recent-games parser.
  if(completeMonths<months.length||!results.size){
    for(const teamId of [...new Set(teamIds)].slice(0,2)){
      if(!/^\d{1,18}$/u.test(teamId))continue
      result.scheduleQueries++
      const schedule=await load(root+'teams/'+teamId+'/schedule?limit=250')
      if(validBoard(schedule)){result.scheduleSuccesses++;take(schedule.events)}
    }
  }
  result.events=[...results.values()].sort((a,b)=>
    Date.parse(asEvent(a).date??'')-Date.parse(asEvent(b).date??''))
  result.status=completeMonths===months.length?'verified':
    completeMonths||result.dailySuccesses||result.scheduleSuccesses?'partial':'unavailable'
  result.explanation='ESPN meses '+result.monthlySuccesses+'/'+months.length+
    '; respaldo por días '+result.dailySuccesses+'/'+result.dailyQueries+
    '; calendarios equipo '+result.scheduleSuccesses+'/'+result.scheduleQueries+
    '; eventos identificados '+result.events.length+
    (result.status!=='verified'?'; cobertura parcial/no disponible':'')
  return result
}
