#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { geocode, reverseGeocode, route } from './phoenix-geo-network.mjs'
function options(args) {
  const result={}
  for(let i=0;i<args.length;i++){
    if(!args[i].startsWith('--')||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Opción inválida: '+args[i])
    result[args[i].slice(2)]=args[++i]
  }
  return result
}
async function main(){
  const [action,...rest]=process.argv.slice(2);const o=options(rest)
  const base={endpoint:process.env.PHOENIX_GEO_ENDPOINT,cachePath:o.cache}
  let result
  if(action==='geocode')result=await geocode(o.address,{...base,endpoint:o.endpoint??base.endpoint})
  else if(action==='reverse')result=await reverseGeocode(JSON.parse(o.position),{...base,endpoint:o.endpoint??base.endpoint})
  else if(action==='route')result=await route(JSON.parse(await readFile(resolve(o.input),'utf8')),{...base,endpoint:o.endpoint??base.endpoint,profile:o.profile??'driving'})
  else throw new Error('Uso: node scripts/phoenix-geo-operations.mjs geocode --address "X" --endpoint https://mi-geocoder.example | reverse --position "[-70.7,19.45]" | route --input stops.json --endpoint https://mi-osrm.example [--output route.geojson]')
  const serialized=JSON.stringify(result,null,2)+'\n'
  if(o.output)await writeFile(resolve(o.output),serialized,'utf8')
  else process.stdout.write(serialized)
}
main().catch(error=>{process.stderr.write('PHOENIX GEO: '+error.message+'\n');process.exitCode=1})
