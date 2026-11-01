/**
 * Historical odds from the two SportsbookReview GitHub scrapers.
 * Historical rows are for backtesting and prior-season context only.
 * Never substitute them for current sportsbook quotes.
 */
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

export type HistoricalMarket = {
  source:'flancast90/sportsbookreview-scraper'|'ArnavSaraogi/mlb-odds-scraper'
  sport:string;date:string;home:string;away:string;bookmaker:string
  market:'h2h';homeDecimal:number|null;awayDecimal:number|null;historical:true
}
const name=(v:unknown):string=>typeof v==='string'?v.trim().slice(0,120):''
const odds=(v:unknown):number|null=>{
  if(typeof v!=='number'&&typeof v!=='string')return null
  const n=Number(v)
  if(!Number.isFinite(n)||Math.abs(n)<100||Math.abs(n)>100000)return null
  return Number((n>0?1+n/100:1+100/Math.abs(n)).toFixed(5))
}
const isoDate=(v:unknown):string=>{
  if(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/u.test(v))return v.slice(0,10)
  if(typeof v==='number'&&Number.isInteger(v)&&/^\d{8}$/u.test(String(v))){
    const s=String(v)
    return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6)
  }
  return ''
}
export function normalizeSportsbookReviewArchive(value:unknown,sport:string):HistoricalMarket[]{
  if(!['nba','mlb','nfl','nhl'].includes(sport))throw Error('Historial SBR: deporte no disponible')
  if(!Array.isArray(value))throw Error('Historial SBR: formato inválido')
  const rows:HistoricalMarket[]=[]
  for(const raw of value.slice(0,100000)){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))continue
    const v=raw as Record<string,unknown>
    const home=name(v.home_team),away=name(v.away_team),day=isoDate(v.date)
    if(!home||!away||!day)continue
    rows.push({source:'flancast90/sportsbookreview-scraper',sport,date:day,home,away,
      bookmaker:'SportsbookReview cierre agregado',market:'h2h',
      homeDecimal:odds(v.home_close_ml),awayDecimal:odds(v.away_close_ml),historical:true})
  }
  return rows
}
export function normalizeMlbHistoricalArchive(value:unknown):HistoricalMarket[]{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Historial MLB: formato inválido')
  const rows:HistoricalMarket[]=[]
  for(const [date,games] of Object.entries(value).slice(0,4000)){
    if(!/^\d{4}-\d{2}-\d{2}$/u.test(date)||!Array.isArray(games))continue
    for(const game of games.slice(0,40)){
      if(!game||typeof game!=='object')continue
      const row=game as Record<string,unknown>
      const view=row.gameView as Record<string,unknown>|undefined
      const oddsGroup=row.odds as Record<string,unknown>|undefined
      const home=name((view?.homeTeam as Record<string,unknown>|undefined)?.fullName)
      const away=name((view?.awayTeam as Record<string,unknown>|undefined)?.fullName)
      if(!home||!away)continue
      const bookmakerRows=oddsGroup?.moneyline
      if(!Array.isArray(bookmakerRows))continue
      for(const book of bookmakerRows.slice(0,25)){
        if(!book||typeof book!=='object')continue
        const b=book as Record<string,unknown>
        const current=b.currentLine as Record<string,unknown>|undefined
        const nameBook=name(b.sportsbook)
        if(!nameBook)continue
        rows.push({source:'ArnavSaraogi/mlb-odds-scraper',sport:'mlb',date,home,away,
          bookmaker:nameBook,market:'h2h',homeDecimal:odds(current?.homeOdds),
          awayDecimal:odds(current?.awayOdds),historical:true})
      }
    }
  }
  return rows
}
export async function loadHistoricalOdds(
  sport:string,env:NodeJS.ProcessEnv=process.env,
):Promise<{sources:Array<{name:string;available:boolean;count:number;error?:string}>;
  historical:HistoricalMarket[]; liveQuotes:false}>{
  if(!['nba','mlb','nfl','nhl'].includes(sport))throw Error('Archivo histórico disponible para NBA, MLB, NFL, NHL')
  const directory=env.PHOENIX_SPORTS_HISTORY_DIR??''
  if(!isAbsolute(directory))throw Error('Configura PHOENIX_SPORTS_HISTORY_DIR como ruta absoluta a los datos históricos')
  const filenames:Array<{name:string;file:string;parse:(x:unknown)=>HistoricalMarket[]}>= [
    {name:'flancast90/sportsbookreview-scraper',file:'sportsbookreview-'+sport+'.json',
      parse:x=>normalizeSportsbookReviewArchive(x,sport)},
    ...(sport==='mlb'?[{name:'ArnavSaraogi/mlb-odds-scraper',file:'mlb-odds.json',
      parse:normalizeMlbHistoricalArchive}]:[]),
  ]
  const sources:Array<{name:string;available:boolean;count:number;error?:string}>=[]
  const historical:HistoricalMarket[]=[]
  for(const spec of filenames){
    try{
      const path=join(directory,spec.file)
      if((await stat(path)).size>100_000_000)throw Error('Archivo supera límite de 100 MB')
      const data=JSON.parse(await readFile(path,'utf8')) as unknown
      const normalized=spec.parse(data)
      historical.push(...normalized)
      sources.push({name:spec.name,available:true,count:normalized.length})
    }catch(error){
      sources.push({name:spec.name,available:false,count:0,
        error:error instanceof Error?error.message.slice(0,160):'Fallo de lectura'})
    }
  }
  return {sources,historical:historical.slice(-120000),liveQuotes:false}
}
