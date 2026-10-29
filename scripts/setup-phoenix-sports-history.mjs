#!/usr/bin/env node
/** Download published, historical-only GitHub datasets to a user-owned Phoenix cache.
 * No scraping of live markets, no credentials, and no GitHub API token needed.
 */
import {get} from 'node:https'
import {createWriteStream} from 'node:fs'
import {mkdir,readFile,rename,rm,stat} from 'node:fs/promises'
import {homedir} from 'node:os'
import {isAbsolute,join} from 'node:path'
import {pipeline} from 'node:stream/promises'
const dir=process.env.PHOENIX_SPORTS_HISTORY_DIR??join(homedir(),'.phoenix','sports-history')
if(!isAbsolute(dir))throw Error('PHOENIX_SPORTS_HISTORY_DIR debe ser absoluta')
const sources=['nfl','nba','nhl','mlb'].map(s=>({
  name:'sportsbookreview-'+s+'.json',
  url:'https://raw.githubusercontent.com/flancast90/sportsbookreview-scraper/main/data/'+s+'_archive_10Y.json',
  cap:24_000_000,
}))
sources.push({
  name:'mlb-odds.json',
  url:'https://github.com/ArnavSaraogi/mlb-odds-scraper/releases/download/dataset/mlb_odds_dataset.json',
  cap:85_000_000,
})
const allowed=new Set(['github.com','raw.githubusercontent.com','release-assets.githubusercontent.com','objects.githubusercontent.com'])
async function retrieve(url,destination,cap,hops=0){
  if(hops>5)throw Error('Demasiadas redirecciones')
  const u=new URL(url)
  if(u.protocol!=='https:'||!allowed.has(u.hostname)||u.username||u.password)throw Error('Host no permitido')
  return new Promise((resolve,reject)=>{
    get(u,{headers:{'User-Agent':'Phoenix-Sports-Historical-Reader/1.0'}},async res=>{
      try{
        if([301,302,303,307,308].includes(res.statusCode??0)){
          const redirect=res.headers.location
          res.resume()
          if(!redirect)throw Error('Redirección sin destino')
          resolve(await retrieve(new URL(redirect,u).toString(),destination,cap,hops+1));return
        }
        if(res.statusCode!==200){res.resume();throw Error('HTTP '+res.statusCode)}
        const length=Number(res.headers['content-length']??0)
        if(length>cap){res.resume();throw Error('Archivo supera el límite')}
        let received=0
        res.on('data',chunk=>{received+=chunk.length;if(received>cap)res.destroy(Error('Archivo demasiado grande'))})
        await pipeline(res,createWriteStream(destination,{flags:'wx',mode:0o600}))
        resolve(undefined)
      }catch(error){reject(error)}
    }).on('error',reject)
  })
}
await mkdir(dir,{recursive:true})
let failed=0
for(const source of sources){
  const final=join(dir,source.name),tmp=final+'.partial-'+process.pid
  try{
    const existing=await stat(final).catch(()=>null)
    if(existing?.size){console.log(source.name+': ya descargado');continue}
    await retrieve(source.url,tmp,source.cap)
    const data=JSON.parse(await readFile(tmp,'utf8'))
    if(data===null||typeof data!=='object')throw Error('Dataset JSON inválido')
    await rename(tmp,final)
    console.log(source.name+': archivo histórico disponible (nunca cotizaciones actuales)')
  }catch(error){
    failed++
    console.error(source.name+': '+(error instanceof Error?error.message:'Error desconocido'))
  }finally{await rm(tmp,{force:true})}
}
if(failed)process.exitCode=1
console.log('Archivos históricos: '+dir)
