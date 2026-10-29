#!/usr/bin/env node
/**
 * Explicit, bounded on-demand collection from the TWO historical GitHub
 * scrapers. Never invoked by the automatic update or real-time odds tool.
 * The tools may be blocked by the source website and can take several minutes.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const exec=promisify(execFile)
const root=resolve(process.env.PHOENIX_SPORTS_SOURCE_HOME||
  join(homedir(),'.phoenix','sports-sources'))
const vendor=join(root,'vendor'),output=join(root,'history','collected')
const py=process.platform==='win32'?join(root,'.venv','Scripts','python.exe'):
  join(root,'.venv','bin','python')
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&
  !Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s

export function historicalJob(opts,now=Date.now()){
  const source=opts.source
  if(source==='sportsbookreview'){
    const sport=opts.sport
    const start=Number(opts.startYear),end=Number(opts.endYear??start)
    if(!['nba','nfl','nhl','mlb'].includes(sport)||!Number.isInteger(start)
      ||!Number.isInteger(end)||start<2007||end>2021||end<start||end-start>1)
      throw Error('SportsbookReview admite NBA/NFL/NHL/MLB y máximo dos temporadas 2007-2021 por ejecución')
    const label='phoenix_'+sport+'_'+start+'_'+end
    return {folder:'sportsbookreview-scraper',script:'cli.py',
      args:['--sport',sport,'--start',String(start),'--end',String(end),
        '--filename',label,'--format','json'],
      outputName:'sportsbookreview-'+sport+'-'+start+'-'+end+'.json',
      relativeFile:join('data',label+'.json')}
  }
  if(source==='mlb'){
    const start=opts.startDate,end=opts.endDate??start
    if(!validDate(start)||!validDate(end))throw Error('Fechas MLB inválidas (YYYY-MM-DD)')
    const first=Date.parse(start+'T00:00:00Z'),last=Date.parse(end+'T00:00:00Z')
    if(first>last||last-first>6*86400000||last>=now)
      throw Error('MLB histórico: máximo siete fechas pasadas por ejecución')
    const markets=(opts.markets??'moneyline,pointspread,totals').split(',')
    if(!markets.length||markets.length>3||
      markets.some(x=>!['moneyline','pointspread','totals'].includes(x)))
      throw Error('Mercados históricos MLB inválidos')
    const label='phoenix-mlb-'+start+'-'+end+'.json'
    return {folder:'mlb-odds-scraper',script:'scraper.py',
      args:[start,end,'-t',...markets,'-c','2','-o',label],
      outputName:label,relativeFile:label}
  }
  throw Error('Proveedor histórico no permitido')
}
export async function collectHistorical(opts){
  const job=historicalJob(opts)
  const cwd=join(vendor,job.folder)
  await access(py);await access(join(cwd,job.script))
  await mkdir(output,{recursive:true})
  const args=[job.script,...job.args]
  // No shell, bounded network cost, official CLI arguments, fixed output path.
  await exec(py,args,{cwd,windowsHide:true,shell:false,timeout:300000,maxBuffer:500000})
  const source=join(cwd,job.relativeFile)
  const info=await stat(source)
  if(!info.isFile()||info.size<2||info.size>40_000_000)
    throw Error('Archivo histórico vacío o demasiado grande: '+job.outputName)
  // Parse results before accepting; HTML error pages may otherwise look like
  // successful archives. Both upstream CLIs write JSON.
  const data=JSON.parse(await readFile(source,'utf8'))
  if(!data||typeof data!=='object')throw Error('JSON histórico inválido')
  const dest=join(output,job.outputName)
  await copyFile(source,dest)
  return {provider:opts.source,source:'historical-scraper',file:dest,
    sizeBytes:info.size,entries:Array.isArray(data)?data.length:Object.keys(data).length,
    isLivePrice:false,warning:'Datos históricos. NO usar como cotización vigente.'}
}
const thisFile=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url
if(thisFile){
  const args=Object.fromEntries(process.argv.slice(2).filter(x=>x.startsWith('--'))
    .map(x=>x.slice(2).split('=',2)))
  if(args.run!=='1')console.error('Uso: --run=1 --source=mlb --startDate=2025-08-01 --endDate=2025-08-02, o --source=sportsbookreview --sport=nhl --startYear=2021')
  else collectHistorical(args).then(x=>console.log(JSON.stringify(x)),
    e=>{console.error('[PHOENIX historical] '+String(e));process.exitCode=1})
}
