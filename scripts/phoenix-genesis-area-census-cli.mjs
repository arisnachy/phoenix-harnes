/**
 * Local command-line operation for Genesis 360-degree hospital census.
 * No network access, credentials, clinical data or private documents.
 *
 * node scripts/phoenix-genesis-area-census-cli.mjs summary hospital_demo
 * node scripts/phoenix-genesis-area-census-cli.mjs pending hospital_demo
 * node scripts/phoenix-genesis-area-census-cli.mjs assess decision.json
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GenesisWorkbench } from './phoenix-genesis-workbench.mjs'
import { genesisDatabasePath } from './phoenix-genesis-paths.mjs'
import { listGenesisAreaCensus,assessGenesisArea } from './phoenix-genesis-area-census.mjs'
export function genesisAreaCensusCli(argv,dbPath){
  const store=new GenesisWorkbench(dbPath)
  try{
    const [action,value]=argv
    if(action==='summary'&&argv.length===2){
      const report=listGenesisAreaCensus(store,value)
      return {organizationId:report.organizationId,available:report.available,
        total:report.total,summary:report.summary,note:report.note}
    }
    if(action==='pending'&&argv.length===2){
      const report=listGenesisAreaCensus(store,value)
      return {organizationId:report.organizationId,
        areas:report.areas.filter(x=>x.reviewState!=='verified').map(x=>({
          areaId:x.areaId,name:x.name,domain:x.domain,
          dataNeeded:x.dataNeeded,expectedReports:x.expectedReports,
          state:x.state,reviewState:x.reviewState
        })),summary:report.summary}
    }
    if(action==='list'&&argv.length===2)return listGenesisAreaCensus(store,value)
    if(action==='assess'&&argv.length===2)
      return assessGenesisArea(store,JSON.parse(readFileSync(value,'utf8')))
    throw Error('Uso: summary <org> | pending <org> | list <org> | assess <decision.json>')
  }finally{store.close()}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  try{console.log(JSON.stringify(genesisAreaCensusCli(process.argv.slice(2),
    genesisDatabasePath()),null,2))}
  catch(e){console.error('Genesis Area Census: '+e.message);process.exitCode=1}
}
