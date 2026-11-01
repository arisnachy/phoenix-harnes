/** Keep sport diversity without fabricating extra evidence-based favorites. */
export type RankedSportsCandidate={
  rank:number
  pick:{sport:string;league:string;eventId:string}
}
/** Prioritize distinct active sports before selecting more leagues.
 * @param eligible - Leagues with activity counts.
 * @param maxLeagues - Maximum leagues to investigate.
 * @returns Deterministic shortlist with discipline diversity prioritized.
 */
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
/** Select ranked candidates without falsely satisfying multisport requirements.
 * @param ranked - Evidence-ranked candidates.
 * @param count - Requested selection count.
 * @param multisport - Whether distinct sports are required.
 * @returns Selected candidates and a truthful diversity-satisfaction flag.
 */
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
  for(const row of sorted){
    if(chosen.length>=count)break
    if(!chosen.includes(row))chosen.push(row)
  }
  const diversitySatisfied=!multisport||count<=1||
    new Set(chosen.map(row=>row.pick.sport)).size>=2
  // An all-NHL 5/5 ticket is NOT a completed 'multideporte' request.
  // Retain the strongest <= 4 research hypotheses as an incomplete draft.
  if(!diversitySatisfied&&chosen.length>=count)chosen.pop()
  return{chosen,diversitySatisfied}
}
