#!/usr/bin/env node
/**
 * PostGIS + actual H3-pg adapter. Requires psql on PATH, operator-configured
 * PG* connection variables. H3 action also needs h3 + h3_postgis >= 4.2.3.
 */
import {spawn} from 'node:child_process'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {compileGeoJson} from './phoenix-geo.mjs'
const scopedRe=/^[a-zA-Z0-9_.-]{1,80}$/
export function scoped(v){if(typeof v!=='string'||!scopedRe.test(v))throw Error('Identificador de área/trabajo inválido');return v}
const q=v=>"'"+scoped(v)+"'"
export function planarQuery(workspace,scene,size){
 const w=q(workspace),s=q(scene)
 if(!Number.isInteger(size)||size<50||size>100000)throw Error('Hexágono planar: 50 a 100000 metros')
 return [
  'WITH inputs AS (SELECT ST_Transform(ST_PointOnSurface(geom),3857) AS pt,value FROM phoenix_geo.features',
  'WHERE workspace_key='+w+' AND scene_key='+s+'),',
  'bounds AS (SELECT ST_Envelope(ST_Collect(pt)) AS b FROM inputs),',
  'grid AS (SELECT cell.geom, cell.i, cell.j FROM bounds',
  'CROSS JOIN LATERAL ST_HexagonGrid('+size+',bounds.b) AS cell),',
  'counts AS (SELECT grid.i,grid.j,grid.geom,COUNT(*)::integer AS n,AVG(inputs.value) AS avg_val',
  'FROM grid JOIN inputs ON ST_Intersects(grid.geom,inputs.pt)',
  'GROUP BY grid.i,grid.j,grid.geom ORDER BY n DESC LIMIT 3000)',
  "SELECT json_build_object('type','FeatureCollection','features',COALESCE(json_agg(",
  "json_build_object('type','Feature','id',i||':'||j,'properties',",
  "json_build_object('name','Hex '||i||':'||j,'value',avg_val,'count',n),",
  "'geometry',ST_AsGeoJSON(ST_Transform(geom,4326))::json)), '[]'::json)) FROM counts;",
 ].join(' ')
}
export function h3Query(workspace,scene,res){
 const w=q(workspace),s=q(scene)
 if(!Number.isInteger(res)||res<0||res>15)throw Error('H3 requiere resolución 0..15')
 return [
  'WITH points AS (SELECT h3_latlng_to_cell(ST_PointOnSurface(geom),'+res+') AS cell,value',
  'FROM phoenix_geo.features WHERE workspace_key='+w+' AND scene_key='+s+'),',
  'counts AS (SELECT cell,COUNT(*)::integer n,AVG(value) AS avg_val FROM points',
  'GROUP BY cell ORDER BY n DESC LIMIT 3000)',
  "SELECT json_build_object('type','FeatureCollection','features',COALESCE(json_agg(",
  "json_build_object('type','Feature','id',cell::text,'properties',",
  "json_build_object('name','H3 '||cell::text,'value',avg_val,'count',n),",
  "'geometry',ST_AsGeoJSON(h3_cell_to_boundary_geometry(cell))::json)), '[]'::json)) FROM counts;",
 ].join(' ')
}
export function copyScript(workspace,scene,fc){
 const w=q(workspace),s=q(scene)
 if(fc?.type!=='FeatureCollection'||!Array.isArray(fc.features)||fc.features.length>3000)
   throw Error('Se requiere FeatureCollection de máximo 3000 geometrías')
 const esc=value=>'"'+String(value).replace(/[\r\n]/g,' ').replace(/"/g,'""')+'"'
 const rows=fc.features.map((f,i)=>{
  if(!f?.geometry||typeof f.geometry.type!=='string'||!f.geometry.coordinates)throw Error('Geometría inválida '+i)
  const props=f.properties && typeof f.properties==='object'&&!Array.isArray(f.properties)?f.properties:{}
  const n=props.value===null||props.value===undefined?'':Number(props.value)
  if(n!==''&&!Number.isFinite(n))throw Error('Valor numérico inválido '+i)
  const id=String(f.id??props.id??('elemento-'+(i+1))).slice(0,100)
  const label=String(props.label??props.name??id).slice(0,160)
  return [id,label,n,JSON.stringify(f.geometry),JSON.stringify(props)].map(esc).join(',')
 }).join('\n')
 return [
 'BEGIN;',
 'CREATE TEMP TABLE geo_stage (feature_key text,label text,metric text,geom_json text,props_json text) ON COMMIT DROP;',
 'COPY geo_stage(feature_key,label,metric,geom_json,props_json) FROM STDIN WITH (FORMAT csv);',
 rows,
 '\\.',
 'DELETE FROM phoenix_geo.features WHERE workspace_key='+w+' AND scene_key='+s+';',
 'INSERT INTO phoenix_geo.features(workspace_key,scene_key,feature_key,label,value,geom,props)',
 'SELECT '+w+','+s+',feature_key,label,NULLIF(metric,\'\')::double precision,',
 'ST_SetSRID(ST_GeomFromGeoJSON(geom_json),4326),props_json::jsonb FROM geo_stage;',
 'COMMIT;','',
 ].join('\n')
}
export async function psql(sql,{file}={}){
 const env={...process.env}
 if(env.PHOENIX_GEO_DATABASE_URL){env.PGDATABASE=env.PHOENIX_GEO_DATABASE_URL;delete env.PHOENIX_GEO_DATABASE_URL}
 return new Promise((res,rej)=>{
  const args=['--no-psqlrc','--no-password','--set=ON_ERROR_STOP=1','--tuples-only','--no-align']
  if(file)args.push('--file',file)
  const p=spawn('psql',args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']})
  let out='',err=''
  p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8')
  p.stdout.on('data',v=>{out+=v;if(out.length>30_000_000)p.kill()})
  p.stderr.on('data',v=>{err+=v;if(err.length>4000)p.kill()})
  p.on('error',rej)
  p.on('close',code=>code===0?res(out.trim()):rej(Error('psql salió '+code+': '+err.slice(0,600))))
  p.stdin.on('error',()=>{})
  p.stdin.end(sql??'')
 })
}
function opts(argv){const o={};for(let i=0;i<argv.length;i++){if(!argv[i]?.startsWith('--')||!argv[i+1])throw Error('Parámetro inválido');o[argv[i].slice(2)]=argv[++i]}return o}
async function main(){
 const [cmd,...rest]=process.argv.slice(2),o=opts(rest)
 if(cmd==='init'){await psql('',{file:fileURLToPath(new URL('./phoenix-geo-postgis.sql',import.meta.url))});process.stdout.write('PostGIS initialized\n');return}
 const w=scoped(o.workspace),s=scoped(o.scene)
 if(cmd==='import'){await psql(copyScript(w,s,JSON.parse(await readFile(resolve(o.input),'utf8'))));process.stdout.write('Datos importados\n');return}
 if(cmd!=='h3'&&cmd!=='hex')throw Error('Uso: geo:db init | import --workspace W --scene S --input datos.geojson | hex --size 500 --workspace W --scene S | h3 --resolution 8 --workspace W --scene S')
 const sql=cmd==='hex'?planarQuery(w,s,Number(o.size??500)):h3Query(w,s,Number(o.resolution??8))
 const data=JSON.parse(await psql(sql))
 if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))throw Error('Respuesta DB no es GeoJSON')
 if(o.output)await writeFile(resolve(o.output),JSON.stringify(data,null,2)+'\n')
 else process.stdout.write(JSON.stringify(data,null,2)+'\n')
 if(o.map){const result=compileGeoJson(data,{source:'PostGIS '+w+'/'+s,title:o.title??'Análisis espacial',theme:o.theme??'research'});await writeFile(resolve(o.map),JSON.stringify(result.spec,null,2)+'\n')}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{process.stderr.write('PHOENIX GEO DB: '+e.message+'\n');process.exitCode=1})
