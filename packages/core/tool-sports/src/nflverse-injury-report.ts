/** NFL injury reports from the free, attributed nflverse seasonal CSV release.
 * Report status is not a confirmed active/inactive list or starting QB.
 * Fail closed on stale, mismatched, malformed and unavailable release data.
 * Source: https://github.com/nflverse/nflverse-data/releases
 */
export type NflverseInjury={team:string;name:string;position:string;
  status:string;injury:string;modifiedAt:string;week:number}
export type NflverseInjuryReview={source:string;checkedAt:string;
  status:'verified'|'partial'|'unavailable'|'stale';
  teamsCovered:string[];injuries:NflverseInjury[];warning:string}
const names:Record<string,string>={
  'Arizona Cardinals':'ARI','Atlanta Falcons':'ATL','Baltimore Ravens':'BAL',
  'Buffalo Bills':'BUF','Carolina Panthers':'CAR','Chicago Bears':'CHI',
  'Cincinnati Bengals':'CIN','Cleveland Browns':'CLE','Dallas Cowboys':'DAL',
  'Denver Broncos':'DEN','Detroit Lions':'DET','Green Bay Packers':'GB',
  'Houston Texans':'HOU','Indianapolis Colts':'IND','Jacksonville Jaguars':'JAX',
  'Kansas City Chiefs':'KC','Las Vegas Raiders':'LV','Los Angeles Chargers':'LAC',
  'Los Angeles Rams':'LA','Miami Dolphins':'MIA','Minnesota Vikings':'MIN',
  'New England Patriots':'NE','New Orleans Saints':'NO','New York Giants':'NYG',
  'New York Jets':'NYJ','Philadelphia Eagles':'PHI','Pittsburgh Steelers':'PIT',
  'San Francisco 49ers':'SF','Seattle Seahawks':'SEA','Tampa Bay Buccaneers':'TB',
  'Tennessee Titans':'TEN','Washington Commanders':'WAS'}
const aliases:Record<string,string[]>={LA:['LA','LAR'],LV:['LV','OAK'],WAS:['WAS','WSH']}
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const teamCode=(name:string)=>Object.entries(names).find(([key])=>norm(key)===norm(name))?.[1]??''
/** Streaming-like bounded parser for RFC4180 quotes and embedded newlines. */
export function parseNflverseCsv(content:string):Record<string,string>[]{
  if(content.length>2_000_000)throw Error('nflverse CSV excede 2 MB')
  const rows:string[][]=[],row:string[]=[]
  let field='',inside=false
  for(let i=0;i<content.length;i++){
    const c=content[i]
    if(inside){
      if(c==='"'&&content[i+1]==='"'){field+='"';i++}
      else if(c==='"')inside=false
      else field+=c
    }else if(c==='"')inside=true
    else if(c===','){row.push(field);field=''}
    else if(c==='\n'){
      row.push(field.replace(/\r$/u,''));field=''
      if(row.some(Boolean))rows.push(row.splice(0))
      if(rows.length>12000)throw Error('CSV con demasiadas filas')
    }else field+=c
  }
  if(inside)throw Error('CSV con comillas sin cerrar')
  if(field||row.length){row.push(field.replace(/\r$/u,''));rows.push(row)}
  const header=rows.shift()?.map(x=>x.trim().replace(/^\uFEFF/u,''))??[]
  for(const required of ['season','team','week','full_name','report_status','date_modified'])
    if(!header.includes(required))throw Error('Esquema nflverse incompleto: '+required)
  return rows.map(values=>Object.fromEntries(header.map((name,i)=>[name,values[i]??''])))
}
export async function nflverseInjuryReport(
  fixture:{home:string;away:string;kickoff:string;date:string},
  fetcher:typeof fetch=fetch,now=Date.now(),
  env:NodeJS.ProcessEnv=process.env):Promise<NflverseInjuryReview>{
  // NFL postseason in January/February belongs to the previous fall season.
  const season=Number(fixture.date.slice(0,4))-
    (Number(fixture.date.slice(5,7))<=3?1:0)
  const source='https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_'+
    season+'.csv'
  const base={source,checkedAt:new Date(now).toISOString()}
  const missing=(status:NflverseInjuryReview['status'],warning:string):NflverseInjuryReview=>
    ({...base,status,teamsCovered:[],injuries:[],warning})
  if(env.PHOENIX_SPORTS_FREE_BACKUPS_DISABLED==='1')
    return missing('unavailable','Fuente gratuita desactivada')
  const kickoff=Date.parse(fixture.kickoff)
  const home=teamCode(fixture.home),away=teamCode(fixture.away)
  if(!/^\d{4}-\d{2}-\d{2}$/u.test(fixture.date)||
    !Number.isFinite(kickoff)||!home||!away||home===away)
    return missing('unavailable','Equipos o fecha NFL no reconocidos; sin inferir lesiones')
  try{
    const response=await fetcher(source,{redirect:'follow',
      headers:{accept:'text/csv'},signal:AbortSignal.timeout(9000)})
    if(!response.ok)return missing('unavailable','nflverse HTTP '+response.status)
    if(Number(response.headers.get('content-length')||0)>2_000_000)
      return missing('unavailable','Reporte supera límite seguro')
    const csv=await response.text()
    const rows=parseNflverseCsv(csv)
    const validTeams=new Map([[home,new Set(aliases[home]??[home])],
      [away,new Set(aliases[away]??[away])]])
    const current=rows.filter(r=>{
      const modified=Date.parse(r.date_modified??'')
      return Number(r.season)===season&&Number.isInteger(Number(r.week))&&
        Number(r.week)>0&&Number.isFinite(modified)&&modified<=now+60_000&&
        modified<=kickoff&&modified>=Math.max(now-7*86_400_000,kickoff-6*86_400_000)&&
        [...validTeams.values()].some(codes=>codes.has(r.team??''))
    })
    if(!current.length)return missing('stale','Sin reporte reciente para ambos clubes')
    const week=Math.max(...current.map(r=>Number(r.week)))
    const latest=current.filter(r=>Number(r.week)===week)
    const covered=[...validTeams.entries()].filter(([,codes])=>
      latest.some(r=>codes.has(r.team??''))).map(([code])=>code)
    const found=new Map<string,NflverseInjury>()
    for(const row of latest){
      const club=[...validTeams.entries()].find(([,codes])=>codes.has(row.team??''))?.[0]
      if(!club||!(row.full_name??'').trim())continue
      const status=(row.report_status??'').trim()
      if(!['Out','Doubtful','Questionable'].includes(status))continue
      const record={team:club,name:(row.full_name??'').slice(0,100),
        position:(row.position??'').slice(0,12),status,
        injury:(row.report_primary_injury??'').slice(0,100),
        modifiedAt:row.date_modified??'',week}
      const key=club+'|'+norm(record.name)
      const prev=found.get(key)
      if(!prev||Date.parse(prev.modifiedAt)<Date.parse(record.modifiedAt))found.set(key,record)
    }
    return{...base,status:covered.length===2?'verified':'partial',
      teamsCovered:covered,injuries:[...found.values()].slice(0,50),
      warning:'Informe semanal nflverse (CC BY 4.0); no sustituye inactivos '+
        'del día ni confirma QB o titulares. Semana '+week+'.'}
  }catch(error){
    return missing('unavailable',(error instanceof Error?error.message:String(error)).slice(0,130))
  }
}
