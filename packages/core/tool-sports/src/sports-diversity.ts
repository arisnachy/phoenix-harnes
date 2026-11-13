/** Keep sport diversity without fabricating extra evidence-based favorites. */
export type RankedSportsCandidate={
  rank:number
  pick:{sport:string;league:string;eventId:string}
}
export function diversifiedSportsShortlist<T extends {sport:string;league:string;active:number}>(
  eligible:readonly T[],maxLeagues=6,
):T[]{
  if(maxLeagues<1)return []
  const ordered=[...eligible].sort((a,b)=>b.active-a.active||
    a.sport.localeCompare(b.sport)||a.league.localeCompare(b.league))
  const leaders: T[]=[]
  const seen=new Set<string>()
  for(const row of ordered){
    if(!seen.has(row.sport)){
      leaders.push(row);seen.add(row.sport)
    }
  }
  // Include top leagues of distinct disciplines before spending all queries
  // on soccer subleagues or a sport with a large nightly slate.
  const chosen=leaders.slice(0,maxLeagues)
  for(const row of ordered){
    if(chosen.length===maxLeagues)break
    if(!chosen.includes(row))chosen.push(row)
  }
  return chosen
}
export function diversifiedSportsPicks<T extends RankedSportsCandidate>(
  ranked:readonly T[],count:number,multisport:boolean,
):{chosen:T[];diversitySatisfied:boolean}{
  const sorted=[...ranked].sort((a,b)=>b.rank-a.rank||
    a.pick.sport.localeCompare(b.pick.sport)||
    a.pick.eventId.localeCompare(b.pick.eventId))
  const chosen:T[]=[]
  if(sorted[0])chosen.push(sorted[0])
  if(multisport&&count>1){
    const other=sorted.find(row=>row.pick.sport!==chosen[0]?.pick.sport)
    if(other)chosen.push(other)
  }
  // Avoid four hockey picks when a comparably ranked NBA/NFL/soccer
  // candidate is still available. Do not substitute a much weaker pick just
  // to satisfy a quota; fill remaining slots from rank order afterward.
  const maxComparablePerSport=Math.ceil(count/2)
  for(const row of sorted){
    if(chosen.length>=count)break
    if(chosen.includes(row))continue
    const sameSport=chosen.filter(x=>x.pick.sport===row.pick.sport).length
    const comparableAlternative=sorted.some(other=>!chosen.includes(other)&&
      other.pick.sport!==row.pick.sport&&other.rank>=row.rank*0.8)
    if(multisport&&sameSport>=maxComparablePerSport&&comparableAlternative)continue
    chosen.push(row)
  }
  for(const row of sorted){
    if(chosen.length>=count)break
    if(!chosen.includes(row))chosen.push(row)
  }
  const diversitySatisfied=!multisport||count<=1||
    new Set(chosen.map(row=>row.pick.sport)).size>=2
  // A single-sport slate is an honest limitation, not a reason to
  // silently discard a verified fifth or sixth fixture. The caller reports
  // diversitySatisfied=false without altering the actual candidate count.
  return{chosen,diversitySatisfied}
}
