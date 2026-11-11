/** Recover exact NFL ESPN fixtures from week-scoped schedules when daily
 * boards return zero events. Never attach an unrelated week, event ID or date.
 */
export type ScoreEvent={id?:string|number;date?:string}
export type ScoreBoard={events?:ScoreEvent[]}
const inDR=(t:number)=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date(t)).replaceAll('-','')
const matches=(event:ScoreEvent,day:string)=>{
  const at=Date.parse(event.date??'')
  return Number.isFinite(at)&&(inDR(at)===day||
    new Date(at).toISOString().slice(0,10).replaceAll('-','')===day)
}
function weeksForDate(day:string){
  const year=Number(day.slice(0,4)),month=Number(day.slice(4,6))
  const season=month<=2?year-1:year
  if(month<=2)return{season,phase:3,weeks:[1,2,3,4,5]}
  if(month===8)return{season,phase:1,weeks:[1,2,3,4]}
  if(month<8)return{season,phase:2,weeks:[]}
  const firstDow=new Date(Date.UTC(season,8,1)).getUTCDay()
  const labor=1+(8-firstDow)%7
  const start=Date.UTC(season,8,labor+3)
  const today=Date.UTC(year,month-1,Number(day.slice(6,8)))
  const week=Math.floor((today-start)/(7*86_400_000))+1
  return{season,phase:2,weeks:[week,week+1,week-1,week+2,week-2]
    .filter(n=>n>=1&&n<=18)}
}
export async function fetchEspnScoreboardWithFallback<T extends ScoreBoard>(
  sport:string,league:string,day:string,read:(uri:string)=>Promise<T>,
  eventId?:string,
):Promise<T>{
  if(!/^\d{8}$/u.test(day))throw Error('Fecha ESPN inválida')
  const endpoint='https://site.api.espn.com/apis/site/v2/sports/'+sport+'/'+league+'/scoreboard?'
  let daily:T|undefined,firstError:unknown
  try{daily=await read(endpoint+'dates='+day)}catch(error){firstError=error}
  const correct=(e:ScoreEvent)=>!eventId||String(e.id??'')===eventId
  if(daily?.events?.some(correct))return daily
  if(sport!=='football'||league!=='nfl'){
    if(daily)return daily
    throw firstError??Error('No fue posible consultar ESPN')
  }
  const {season,phase,weeks}=weeksForDate(day)
  for(const week of weeks){
    try{
      // The verified ESPN NFL fallback uses week+seasontype without dates.
      // A YYYYMMDD dates parameter may silently hide weekly games.
      const response=await read(endpoint+'seasontype='+phase+
        '&week='+week+'&season='+season+'&limit=100')
      const events=(response.events??[]).filter(e=>correct(e)&&matches(e,day))
      if(events.length)return{...response,events} as T
    }catch{/* Continue bounded recovery using an adjacent official NFL week. */}
  }
  if(daily)return daily
  throw firstError??Error('ESPN NFL no devolvió cartelera')
}
