/** Free secondary fixture corroboration. Never converts a roster or a quote into a
 * confirmed starter, official injury, bookmaker price, or calibrated prediction.
 * Both teams, home/away, and the kickoff must agree before evidence is verified.
 */
import {getFeed} from './sports.ts'

export type FreeFixture={sport:string;league:string;eventId:string;date:string;
  home:string;away:string;kickoff:string}
export type BackupFinding={provider:'TheSportsDB'|'OpenLigaDB';
  status:'verified'|'not-found'|'unavailable'|'conflict';
  url:string;checkedAt:string;detail:string}
type Obj=Record<string,unknown>
const obj=(x:unknown):Obj=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Obj:{}
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const str=(x:unknown):string=>typeof x==='string'?x.trim():''
const norm=(x:string):string=>x.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const validDate=(d:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(d)&&
  Number.isFinite(Date.parse(d+'T00:00:00Z'))&&
  new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d
const sportNames:Record<string,string>={
  soccer:'Soccer',basketball:'Basketball',baseball:'Baseball',
  football:'American Football',hockey:'Ice Hockey',tennis:'Tennis'}
const europeanGermanLeagues=new Set(['ger.1'])
const checked=(now:number)=>new Date(now).toISOString()
const inside90=(candidate:string,kickoff:string):boolean=>{
  const a=Date.parse(candidate),b=Date.parse(kickoff)
  return Number.isFinite(a)&&Number.isFinite(b)&&
    Math.abs(a-b)<=90*60_000
}
function compare(home:string,away:string,when:string,input:FreeFixture):
  'verified'|'not-found'|'conflict'{
  const h=norm(home),a=norm(away),expectedH=norm(input.home),expectedA=norm(input.away)
  if(!h||!a||!expectedH||!expectedA||!inside90(when,input.kickoff))
    return'not-found'
  if(h===expectedH&&a===expectedA)return'verified'
  if(h===expectedA&&a===expectedH)return'conflict'
  return'not-found'
}
async function probe(provider:BackupFinding['provider'],url:string,
  rows:(json:unknown)=>unknown[],interpret:(r:unknown)=>{home:string;away:string;when:string},
  input:FreeFixture,fetcher:typeof fetch,now:number):Promise<BackupFinding>{
  const base={provider,url,checkedAt:checked(now)}
  try{
    const data=await getFeed<unknown>(url,fetcher)
    const records=rows(data).slice(0,900)
    let conflict=false
    for(const raw of records){
      const parsed=interpret(raw),status=compare(parsed.home,parsed.away,parsed.when,input)
      if(status==='verified')return{...base,status,detail:'Dos equipos, localía y horario coinciden; solo calendario corroborado'}
      if(status==='conflict')conflict=true
    }
    return{...base,status:conflict?'conflict':'not-found',
      detail:conflict?'El proveedor invierte la localía: comprobar antes del pronóstico':
        'No se encontró pareja exacta; un nivel gratuito incompleto NO confirma ausencia de partido'}
  }catch(e){
    return{...base,status:'unavailable',detail:'Proveedor no disponible: '+
      (e instanceof Error?e.message:String(e)).slice(0,120)}
  }
}
/** Bounded public endpoints. TheSportsDB free day queries may expose only 3 events;
 * failure to match there is NOT contrary evidence. No price, starters or injury
 * claims are inferred from either feed.
 */
export async function crosscheckFreeFixture(input:FreeFixture,
  fetcher:typeof fetch=fetch,now=Date.now(),
  env:NodeJS.ProcessEnv=process.env):Promise<BackupFinding[]>{
  if(!validDate(input.date)||!Number.isFinite(Date.parse(input.kickoff))||
    !input.home.trim()||!input.away.trim())throw Error('Partido secundario inválido')
  if(env.PHOENIX_SPORTS_FREE_BACKUPS_DISABLED==='1')return[]
  const reports:Promise<BackupFinding>[]=[]
  const kind=sportNames[input.sport]
  if(kind){
    const url='https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d='+
      input.date+'&s='+encodeURIComponent(kind)
    reports.push(probe('TheSportsDB',url,x=>arr(obj(x).events),x=>{
      const o=obj(x)
      return{home:str(o.strHomeTeam),away:str(o.strAwayTeam),
        when:str(o.strTimestamp)||str(o.dateEvent)}
    },input,fetcher,now))
  }
  if(input.sport==='soccer'&&europeanGermanLeagues.has(input.league)){
    const year=Number(input.date.slice(0,4))-(Number(input.date.slice(5,7))<7?1:0)
    const url='https://api.openligadb.de/getmatchdata/bl1/'+year
    reports.push(probe('OpenLigaDB',url,arr,x=>{
      const o=obj(x)
      return{home:str(obj(o.team1).teamName),away:str(obj(o.team2).teamName),
        when:str(o.matchDateTimeUTC)||str(o.matchDateTime)}
    },input,fetcher,now))
  }
  return Promise.all(reports)
}
/** Review links only: the listed documents have NOT been parsed or verified for
 * the fixture. Display as missing-source follow-ups, never as injury evidence.
 */
export function freeOfficialFollowUps(sport:string,date:string):string[]{
  if(!validDate(date))return[]
  if(sport==='basketball'&&Number(date.slice(5,7))>=10){
    const year=Number(date.slice(0,4))
    return['NBA: cotejar manualmente informe oficial de lesiones '+
      'https://official.nba.com/nba-injury-report-'+year+'-'+String(year+1).slice(-2)+'-season/']
  }
  if(sport==='football')return[
    'NFL: cotejar lesionados, rosters y depth chart de nflverse '+
    'https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html']
  if(sport==='hockey')return[
    'NHL: contrastar disponibilidad del portero con partes oficiales; roster no confirma titular']
  return[]
}
