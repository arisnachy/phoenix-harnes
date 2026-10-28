/**
 * Optional source bootstrap for PHOENIX Sports. Run explicitly:
 *   node scripts/phoenix-sports-source-bootstrap.mjs
 * Downloads three public, third-party GitHub projects/data and installs
 * OddsHarvester in an isolated Python venv. Never runs implicitly on startup.
 * The operator must review licensing/access terms before enabling scraping.
 */
import { spawn } from 'node:child_process'
import { mkdir, access, copyFile, open, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const home=resolve(process.env.PHOENIX_SPORTS_SOURCE_HOME||join(homedir(),'.phoenix','sports-sources'))
const archives=join(home,'history')
const vendor=join(home,'vendor')
const venv=join(home,'.venv')
const python=process.env.PHOENIX_SPORTS_PYTHON||(process.platform==='win32'?'python':'python3')
const venvPython=process.platform==='win32'?join(venv,'Scripts','python.exe'):join(venv,'bin','python')
const cli=process.platform==='win32'?join(venv,'Scripts','oddsharvester.exe'):join(venv,'bin','oddsharvester')
const exists=async p=>access(p).then(()=>true,()=>false)
const cmd=(program,args,cwd=home)=>new Promise((done,reject)=>{
  const child=spawn(program,args,{cwd,stdio:'inherit',windowsHide:true,shell:false})
  child.on('error',reject)
  child.on('exit',(code)=>code===0?done():reject(Error(program+' failed (exit '+code+')')))
})
async function cloneOnce(name,url){
  const path=join(vendor,name)
  if(await exists(path)){process.stdout.write('Using existing '+name+' clone\n');return path}
  await cmd('git',['clone','--depth','1',url,path])
  return path
}
async function downloadArchive(url,destination,maxBytes=100_000_000){
  if(await exists(destination)){
    const meta=await stat(destination)
    if(meta.size>100&&meta.size<=maxBytes){process.stdout.write('Using existing MLB dataset\n');return}
  }
  const response=await fetch(url,{signal:AbortSignal.timeout(180_000)})
  if(!response.ok||!response.body)throw Error('MLB dataset download returned '+response.status)
  const temp=destination+'.partial'
  const stream=await open(temp,'w')
  let received=0
  try{
    const bound=new Transform({transform(chunk,_enc,callback){
      received+=chunk.length
      if(received>maxBytes)callback(Error('Dataset size exceeded 100 MB'))
      else callback(null,chunk)
    }})
    await pipeline(Readable.fromWeb(response.body),bound,stream.createWriteStream())
    if(received<100)throw Error('Dataset download too small')
    await rename(temp,destination)
  }catch(e){await rm(temp,{force:true});throw e}
  finally{await stream.close()}
}
async function main(){
  await mkdir(vendor,{recursive:true})
  await mkdir(archives,{recursive:true})
  // A pinned Python package avoids silent incompatibility after upstream API changes.
  if(!await exists(venvPython))await cmd(python,['-m','venv',venv])
  await cmd(venvPython,['-m','pip','install','oddsharvester==0.20.0'])
  await cmd(venvPython,['-m','playwright','install','chromium'])
  const [sbr]=await Promise.all([
    cloneOnce('sportsbookreview-scraper','https://github.com/flancast90/sportsbookreview-scraper.git'),
    cloneOnce('mlb-odds-scraper','https://github.com/ArnavSaraogi/mlb-odds-scraper.git'),
  ])
  for(const sport of ['nba','mlb','nfl','nhl']){
    const src=join(sbr,'data',sport+'_archive_10Y.json')
    if(await exists(src))await copyFile(src,join(archives,'sportsbookreview-'+sport+'.json'))
  }
  await downloadArchive('https://github.com/ArnavSaraogi/mlb-odds-scraper/releases/download/dataset/mlb_odds_dataset.json',
    join(archives,'mlb-odds.json'))
  const config=[
    'PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED=1',
    'PHOENIX_SPORTS_ODDSHARVESTER_BIN='+cli,
    'PHOENIX_SPORTS_HISTORY_DIR='+archives,
  ].join('\n')+'\n'
  const configPath=join(home,'phoenix-sports-sources.env')
  await mkdir(dirname(configPath),{recursive:true})
  await writeFile(configPath,config,'utf8')
  process.stdout.write('\nSource files ready in '+home+'\n')
  process.stdout.write('Apply the three environment variables in '+configPath+
    ' to the PHOENIX host after reviewing data-source terms. Restart PHOENIX.\n')
}
main().catch(e=>{process.stderr.write('Sports bootstrap error: '+String(e)+'\n');process.exitCode=1})
