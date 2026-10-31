/** Supported sportsbook scraper disciplines and bounded scan plan.
 * Enumerating a sport does not imply that a provider offers today's markets.
 */
export const oddsDisciplines=[
  {sport:'football',label:'Fútbol / soccer',market:'1x2',leagues:['Premier League','LaLiga','Liga MX','MLS','Champions League']},
  {sport:'basketball',label:'Baloncesto',market:'moneyline',leagues:['NBA','WNBA','otras ligas']},
  {sport:'baseball',label:'Béisbol',market:'moneyline',leagues:['MLB','otras ligas']},
  {sport:'american-football',label:'Fútbol americano',market:'moneyline',leagues:['NFL','college']},
  {sport:'ice-hockey',label:'Hockey hielo',market:'home_away',leagues:['NHL','otras ligas']},
  {sport:'tennis',label:'Tenis',market:'match_winner',leagues:['ATP','WTA','otros circuitos']},
  {sport:'handball',label:'Balonmano',market:'1x2',leagues:['según cobertura del proveedor']},
  {sport:'volleyball',label:'Voleibol',market:'home_away',leagues:['según cobertura del proveedor']},
  {sport:'rugby-league',label:'Rugby league',market:'home_away',leagues:['según cobertura del proveedor']},
  {sport:'rugby-union',label:'Rugby union',market:'home_away',leagues:['según cobertura del proveedor']},
  {sport:'cricket',label:'Críquet',market:'home_away',leagues:['según cobertura del proveedor']},
] as const
/** Stable scraper discipline key from the bounded research scan catalog. */
export type OddsDiscipline=typeof oddsDisciplines[number]['sport']
/** Known league-specific market keys; a broad sport scrape cannot prove league identity. */
export const coveredSportKeys:Readonly<Record<string,readonly string[]>>={
  football:['soccer_epl','soccer_spain_la_liga','soccer_mexico_ligamx',
    'soccer_usa_mls','soccer_uefa_champs_league'],
  basketball:['basketball_nba','basketball_wnba'],
  baseball:['baseball_mlb'],
  'american-football':['americanfootball_nfl'],
  'ice-hockey':['icehockey_nhl'],
  tennis:['tennis_atp','tennis_wta'],
}
/** A sport-wide scrape is NOT proof that its matches belong to NBA, WNBA etc.
 * Fail closed on missing league evidence. The match URL is the fixed OddsPortal
 * URL retained by the scraper and cannot be a free-form source from a user.
 */
export function belongsToLeague(
  sportKey:string,quote:{league?:string;matchLink?:string},
):boolean{
  const league=(quote.league??'').toLowerCase()
  const path=(quote.matchLink??'').toLowerCase()
  const is=(pattern:RegExp)=>pattern.test(league)
  switch(sportKey){
    case 'basketball_nba':return /\bnba\b/u.test(league)&&
      !/\b(?:wnba|nba\s+(?:g\s+league|2k\s+league|summer\s+league|africa\s+league))\b/u.test(league)
    case 'basketball_wnba':return /\bwnba\b/u.test(league)
    case 'baseball_mlb':return /\bmlb\b|major league baseball/u.test(league)
    case 'americanfootball_nfl':return /\bnfl\b|national football league/u.test(league)
    case 'icehockey_nhl':return /\bnhl\b|national hockey league/u.test(league)
    case 'tennis_atp':return /\batp\b/u.test(league)
    case 'tennis_wta':return /\bwta\b/u.test(league)
    case 'soccer_epl':return is(/premier league/u)&&
      (/\bengland\b/u.test(league)||path.includes('/england/'))
    case 'soccer_spain_la_liga':return is(/la ?liga|primera divisi[oó]n/u)&&
      (/spain|españa/u.test(league)||path.includes('/spain/'))
    case 'soccer_mexico_ligamx':return is(/liga mx/u)&&
      (/mexico|méxico/u.test(league)||path.includes('/mexico/'))
    case 'soccer_usa_mls':return is(/\bmls\b|major league soccer/u)&&
      !is(/mls next|mlsnext|next pro|development|academy/u)
    case 'soccer_uefa_champs_league':return is(/champions league/u)&&
      (is(/uefa|europe/u)||path.includes('/europe/'))
    default:return false
  }
}
/** Attributed per-discipline scan result, including explicit empty and error states. */
export type SportScanResult={
  sport:OddsDiscipline;label:string;market:string;leagues:readonly string[];
  status:'observed'|'empty'|'error'|'disabled';total:number;sample:Array<{
    home:string;away:string;league:string;bookmaker:string;market:string;
    selection:string;price:number;updatedAt:string
  }>;error?:string
}
/** Executes a deterministic page of at most four scraper probes. Returning
 * coverage for unprobed disciplines prevents Kira from silently dropping them.
 */
/** Scan a bounded page of supported disciplines without implying full market coverage.
 * @param params - Optional discipline filter and bounded pagination controls.
 * @param lookup - Injected market lookup for one supported discipline and market.
 * @param enabled - Whether provider access is enabled for this scan.
 * @returns Checked results, unprobed disciplines and continuation position.
 */
export async function scanOddsDisciplines(
  params:{sport?:string;offset?:number;limit?:number},
  lookup:(sport:OddsDiscipline,market:string)=>Promise<Array<{
    home:string;away:string;league?:string;bookmaker:string;market:string;
    selection:string;price:number;updatedAt:string
  }>>,
  enabled=true,
):Promise<{totalDisciplines:number;checked:SportScanResult[];
  unprobed:string[];nextOffset:number|null;complete:boolean}>{
  const all=params.sport?oddsDisciplines.filter(s=>s.sport===params.sport):oddsDisciplines
  if(!all.length)throw Error('Disciplina no soportada en OddsHarvester')
  const offset=params.offset??0,limit=params.limit??4
  if(!Number.isInteger(offset)||offset<0||offset>=all.length||
     !Number.isInteger(limit)||limit<1||limit>4)
    throw Error('Ventana del escaneo inválida (máximo cuatro deportes por ronda)')
  const targets=all.slice(offset,offset+limit)
  // Bounded per-page concurrency: 2 scrapers at a time rather than 11 browsers.
  const checked:SportScanResult[]=[]
  for(let i=0;i<targets.length;i+=2){
    const batch=targets.slice(i,i+2)
    const results=await Promise.allSettled(batch.map(s=>enabled?lookup(s.sport,s.market):
      Promise.resolve([])))
    for(const [idx,item] of batch.entries()){
      const outcome=results[idx]!
      const ok=outcome.status==='fulfilled'?outcome.value:[]
      const record:SportScanResult={sport:item.sport,label:item.label,market:item.market,
        leagues:item.leagues,status:!enabled?'disabled':outcome.status==='rejected'?'error':
          ok.length?'observed':'empty',total:ok.length,
        sample:ok.slice(0,6).map(q=>({home:q.home,away:q.away,
          league:q.league??'Liga no identificada',bookmaker:q.bookmaker,
          market:q.market,selection:q.selection,price:q.price,updatedAt:q.updatedAt})),
      }
      if(outcome.status==='rejected'){
        const reason=outcome.reason instanceof Error?outcome.reason.message:'Error desconocido'
        record.error=reason.slice(0,750)
      }
      checked.push(record)
    }
  }
  const next=offset+targets.length
  return {totalDisciplines:all.length,checked,
    unprobed:all.slice(next).map(s=>s.sport),nextOffset:next<all.length?next:null,
    complete:next>=all.length}
}
