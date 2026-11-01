/** Timestamped local odds observations. Never promote archived prices to live quotes.
 * No credentials stored, and no claim that the local archive covers dates before collection.
 */
import { mkdir,readdir,readFile,stat,writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join,resolve } from 'node:path'
import { createHash } from 'node:crypto'

/** One sportsbook offer observed from a real provider at a recorded time. */
export type ObservedOdds={
  eventId:string,bookmaker:string,market:string,selection:string,point?:number|null
  price:number,home:string,away:string,time:string,timeIso?:string
  updatedAt:string,source?:string,sportKey?:string
}
/** Dated offers kept for historical analysis, never represented as live prices. */
export type OddsSnapshot={
  sportKey:string,observedAt:string,historical:true,quotes:ObservedOdds[],source:string
}
const sportValid=(s:string)=>/^[a-z0-9_]{3,80}$/u.test(s)
const dayValid=(d:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(d)&&
  Number.isFinite(Date.parse(d+'T00:00:00Z'))&&
  new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d
const home=(env:NodeJS.ProcessEnv)=>
  resolve(env.PHOENIX_SPORTS_SOURCE_HOME?.trim()||join(homedir(),'.phoenix','sports-sources'))
const useful=(q:ObservedOdds|null|undefined):q is ObservedOdds=>
  q!==null&&q!==undefined&&typeof q.eventId==='string'&&q.eventId.length>0&&
  typeof q.bookmaker==='string'&&q.bookmaker.length>0&&
  typeof q.market==='string'&&typeof q.selection==='string'&&
  Number.isFinite(q.price)&&q.price>1&&q.price<1000&&
  typeof q.home==='string'&&typeof q.away==='string'&&
  Number.isFinite(Date.parse(q.updatedAt))&&
  Number.isFinite(Date.parse(q.timeIso??q.time))
/** Record authentic provider-observed offers without promoting them to live quotes.
 * @param sportKey Validated sport identifier.
 * @param quotes Offers received from the provider.
 * @param env Runtime configuration for the archive directory and opt-out.
 * @param now Millisecond timestamp for the observation.
 * @returns Whether an archive file was written and the number of offers saved.
 */
export async function saveOddsSnapshot(
  sportKey:string,quotes:ObservedOdds[],env:NodeJS.ProcessEnv=process.env,now=Date.now(),
):Promise<{ saved:boolean;count:number }>{
  if(!sportValid(sportKey)||!Number.isFinite(now))throw Error('Clave o fecha de snapshot inválida')
  if(env.PHOENIX_SPORTS_ODDS_SNAPSHOTS_DISABLED==='1')return{ saved:false,count:0 }
  const clean=quotes.filter(useful).slice(0,500)
  if(!clean.length)return{ saved:false,count:0 }
  const observedAt=new Date(now).toISOString(),day=observedAt.slice(0,10)
  const folder=join(home(env),'observed-odds',sportKey,day)
  await mkdir(folder,{ recursive:true })
  const suffix=createHash('sha256').update(JSON.stringify(clean)).digest('hex').slice(0,12)
  const pathname=join(folder,String(now)+'-'+suffix+'.json')
  const payload:OddsSnapshot={ sportKey,observedAt,historical:true,
    quotes:clean,source:'PHOENIX: copia fechada de ofertas observadas; NO cotización vigente' }
  try{await writeFile(pathname,JSON.stringify(payload),{ encoding:'utf8',flag:'wx' })}
  catch(error){
    if((error as NodeJS.ErrnoException).code==='EEXIST')return{ saved:false,count:0 }
    throw error
  }
  return{ saved:true,count:clean.length }
}
/** Search snapshots by UTC observation date rather than event date.
 * Every returned price remains historical regardless of the match date.
 * @param sportKey Validated sport identifier.
 * @param day UTC observation day in YYYY-MM-DD format.
 * @param env Runtime configuration for the archive directory.
 * @param limit Maximum number of quotes to return.
 * @returns Historical observations, row count, coverage, and read errors.
 */
export async function loadOddsSnapshots(
  sportKey:string,day:string,env:NodeJS.ProcessEnv=process.env,limit=150,
):Promise<{ snapshots:OddsSnapshot[];rows:number;coverage:string;errors:string[] }>{
  if(!sportValid(sportKey)||!dayValid(day)||!Number.isInteger(limit)||limit<1||limit>500)
    throw Error('Histórico: deporte/fecha/límite inválidos')
  const folder=join(home(env),'observed-odds',sportKey,day)
  let names:string[]
  try{names=(await readdir(folder)).filter(name=>/^\d{13}-[0-9a-f]{12}\.json$/u.test(name))
    .sort().reverse().slice(0,20)}
  catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')
      return{ snapshots:[],rows:0,coverage:'Ninguna observación guardada para esa fecha',errors:[] }
    throw error
  }
  const snapshots:OddsSnapshot[]=[],errors:string[]=[]
  const seen=new Set<string>()
  for(const name of names){
    if(snapshots.reduce((n,s)=>n+s.quotes.length,0)>=limit)break
    try{
      const path=join(folder,name)
      if((await stat(path)).size>1_000_000)throw Error('Snapshot excesivo')
      const parsed=JSON.parse(await readFile(path,'utf8')) as OddsSnapshot
      if(parsed.sportKey!==sportKey||!dayValid(parsed.observedAt.slice(0,10))||
        parsed.observedAt.slice(0,10)!==day||!Array.isArray(parsed.quotes))
        throw Error('Formato de snapshot inválido')
      const quotes=parsed.quotes.filter(q=>useful(q)&&q.sportKey===sportKey)
        .filter((q)=>{
          const k=[q.eventId,q.bookmaker,q.market,q.selection,q.point??'',q.price,q.updatedAt].join('|')
          if(seen.has(k))return false
          seen.add(k);return true
        }).slice(0,limit-snapshots.reduce((n,s)=>n+s.quotes.length,0))
      if(quotes.length)snapshots.push({ sportKey,observedAt:parsed.observedAt,
        historical:true,source:'PHOENIX · observación histórica',quotes })
    }catch(error){errors.push((error instanceof Error?error.message:'Lectura fallida').slice(0,100))}
  }
  const first=snapshots.at(0),last=snapshots.at(-1)
  return{ snapshots,rows:snapshots.reduce((n,s)=>n+s.quotes.length,0),
    coverage:first&&last?last.observedAt+' — '+first.observedAt:
      'No hay ofertas verificables guardadas para esa fecha',errors }
}
