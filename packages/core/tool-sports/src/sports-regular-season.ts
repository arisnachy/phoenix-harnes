/** ESPN NBA/NFL season classification for pregame statistical evidence.
 * Unknown or conflicting metadata is never treated as verified regular season.
 * Type 1 preseason, 2 regular, 3 postseason across these two leagues.
 */
type SeasonEvidence='regular'|'preseason'|'postseason'|'unknown'
const rec=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[]
function token(v:unknown):SeasonEvidence{
  const s=String(v??'').trim().toLowerCase().replace(/[_-]/gu,' ')
  if(s==='2'||s==='reg'||s==='regular'||s==='regular season')return 'regular'
  if(s==='1'||s==='pre'||s==='preseason'||s==='pre season')return 'preseason'
  if(s==='3'||s==='post'||s==='postseason'||s==='post season'||s==='playoffs')return 'postseason'
  return 'unknown'
}
/** Only event-local season metadata; calendar month alone is insufficient. */
export function classifyEspnSeason(event:unknown):SeasonEvidence{
  const e=rec(event),competition=rec(arr(e.competitions)[0])
  const roots=[e,competition]
  const tokens:SeasonEvidence[]=[]
  for(const root of roots){
    const season=rec(root.season),seasonType=rec(root.seasonType),type=rec(root.type)
    for(const t of [season.type,seasonType.type,root.seasonType,
      season.abbreviation,seasonType.abbreviation,seasonType.name,
      type.abbreviation,type.name]){
      const outcome=token(t)
      if(outcome!=='unknown')tokens.push(outcome)
    }
  }
  return tokens.length>0&&tokens.every(x=>x===tokens[0])?tokens[0]!:'unknown'
}
export const isVerifiedRegularSeason=(event:unknown):boolean=>classifyEspnSeason(event)==='regular'
