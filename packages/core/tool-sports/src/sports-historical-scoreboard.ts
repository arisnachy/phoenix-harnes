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
  requestedDays:number;verifiedCalendarDays:number;
  status:'verified'|'partial'|'unavailable';
  explanation:string
}
export async function readHistoricalScoreboard(root:string,start:string,end:string,
  read:Reader,teamIds:readonly string[]=[]):Promise<HistoryAudit>{
  const begin=Date.parse(start+'T00:00:00Z'),finish=Date.parse(end+'T00:00:00Z')
  if(!/^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/[a-z-]+\/[a-z0-9._-]+\/$/u.test(root)||
    !dayValid(start)||!dayValid(end)||begin>finish||(finish-begin)>62*86_400_000)
    throw Error('Historial ESPN: argumentos fuera de catálogo o ventana')
  const months:string[]=[]
  for(const dt=new Date(Date.UTC(Number(start.slice(0,4)),Number(start.slice(5,7))-1,1));
    dt.getTime()<=finish;dt.setUTCMonth(dt.getUTCMonth()+1))
    months.push(dt.toISOString().slice(0,7).replace('-',''))
  const results=new Map<string,unknown>()
  const goodDays=new Set<string>()
  const result:HistoryAudit={events:[],monthlyQueries:months.length,monthlySuccesses:0,
    dailyQueries:0,dailySuccesses:0,scheduleQueries:0,scheduleSuccesses:0,
    requestedDays:Math.floor((finish-begin)/86_400_000)+1,verifiedCalendarDays:0,
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
    if(validBoard(monthly)&&monthly.events.length<500&&
      (monthly.events.length>0||!teamIds.length)){
      result.monthlySuccesses++;completeMonths++;take(monthly.events)
      const a=Math.max(begin,Date.UTC(Number(month.slice(0,4)),Number(month.slice(4,6))-1,1))
      const b=Math.min(finish,Date.UTC(Number(month.slice(0,4)),Number(month.slice(4,6)),0))
      for(let t=a;t<=b;t+=86_400_000)goodDays.add(new Date(t).toISOString().slice(0,10))
      continue
    }
    const year=Number(month.slice(0,4)),m=Number(month.slice(4,6))-1
    const lo=Math.max(begin,Date.UTC(year,m,1))
    const hi=Math.min(finish,Date.UTC(year,m+1,0))
    const days=Array.from({length:Math.floor((hi-lo)/86_400_000)+1},
      (_,i)=>new Date(lo+i*86_400_000).toISOString().slice(0,10))
    // An empty month does not prove absence of games. Try a bounded daily
    // fallback; preserve true partial coverage if not every day was read.
    const candidates=days.length>14?days.slice(-14):days
    // Two boundary probes avoid a flood when ESPN as a whole is down.
    const probes=[...new Set([candidates[0],candidates[candidates.length-1]].filter((x):x is string=>!!x))]
    const fetchDay=async(day:string)=>{
      const board=await load(root+'scoreboard?dates='+day.replaceAll('-','')+'&limit=500')
      result.dailyQueries++
      if(validBoard(board)){result.dailySuccesses++;goodDays.add(day);take(board.events);return true}
      return false
    }
    const checks=await Promise.all(probes.map(fetchDay))
    if(!checks.some(Boolean))continue
    const visited=new Set(probes),remaining=candidates.filter(day=>!visited.has(day))
    let index=0,successes=checks.filter(Boolean).length
    await Promise.all(Array.from({length:Math.min(4,remaining.length)},async()=>{
      while(index<remaining.length){
        const day=remaining[index++]!
        if(await fetchDay(day))successes++
      }
    }))
    if(successes===days.length&&candidates.length===days.length)completeMonths++
  }
  // Independent ESPN team-schedule route after broken month/day responses.
  // A schedule is not a boxscore; only completed events with actual scores
  // will be counted later by each sport's recent-games parser.
  if(completeMonths<months.length||!results.size){
    // On monthly and daily outages diversify the last-resort recovery to
    // three entire fixtures at most. A bounded six team-schedule GETs is
    // cheaper than repeating league scans with zero historical evidence.
    for(const teamId of [...new Set(teamIds)].slice(0,6)){
      if(!/^\d{1,18}$/u.test(teamId))continue
      result.scheduleQueries++
      const schedule=await load(root+'teams/'+teamId+'/schedule?limit=250')
      if(validBoard(schedule)){result.scheduleSuccesses++;take(schedule.events)}
    }
  }
  result.verifiedCalendarDays=goodDays.size
  result.events=[...results.values()].sort((a,b)=>
    Date.parse(asEvent(a).date??'')-Date.parse(asEvent(b).date??''))
  result.status=completeMonths===months.length?'verified':
    completeMonths||result.dailySuccesses||result.scheduleSuccesses?'partial':'unavailable'
  result.explanation='ESPN meses '+result.monthlySuccesses+'/'+months.length+
    '; respaldo por días '+result.dailySuccesses+'/'+result.dailyQueries+
    '; días de calendario comprobados '+result.verifiedCalendarDays+'/'+result.requestedDays+
    '; calendarios equipo '+result.scheduleSuccesses+'/'+result.scheduleQueries+
    '; eventos identificados '+result.events.length+
    (result.status!=='verified'?'; cobertura parcial/no disponible':'')
  return result
}
