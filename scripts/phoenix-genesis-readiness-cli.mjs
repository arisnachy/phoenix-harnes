/**
 * Genesis readiness report CLI.
 * Use explicitly provided output paths; existing files are never overwritten.
 */
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import { isAbsolute,extname } from 'node:path'
import { GenesisWorkbench } from './phoenix-genesis-workbench.mjs'
import { genesisDatabasePath } from './phoenix-genesis-paths.mjs'
import { buildGenesisReadinessBrief,renderGenesisReadinessHtml } from './phoenix-genesis-readiness-brief.mjs'

export function runGenesisReadinessCli(args,dbPath){
  const [action,org,output]=args
  if(!['summary','json','html'].includes(action)||!org||args.length<(action==='summary'?2:3))
    throw Error('Uso: summary <organizationId> | json <org> <ruta-absoluta.json> | html <org> <ruta-absoluta.html>')
  if((action==='json'||action==='html')&&
    (!isAbsolute(output)||extname(output).toLowerCase()!=='.'+action))
    throw Error('Indica una ruta absoluta de archivo .'+action)
  const store=new GenesisWorkbench(dbPath)
  let report
  try{report=buildGenesisReadinessBrief(store,org)}finally{store.close()}
  if(action==='summary')return {
    organization:report.organization,discovery:report.discovery,
    inventory:report.inventory,census:report.census,
    pendingActions:report.priorities.length,
    draft:true,sourceSha256:report.sourceSha256
  }
  const contents=action==='json'?JSON.stringify(report,null,2)+'\n':
    renderGenesisReadinessHtml(report)
  writeFileSync(output,contents,{flag:'wx',mode:0o600})
  return {output,type:report.type,generatedAt:report.generatedAt,
    sourceSha256:report.sourceSha256,actions:report.priorities.length,
    warning:'BORRADOR INTERNO: sin validez regulatoria ni aprobación automática'}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  try{console.log(JSON.stringify(runGenesisReadinessCli(process.argv.slice(2),
    genesisDatabasePath()),null,2))}
  catch(e){console.error('Genesis Readiness: '+e.message);process.exitCode=1}
}
