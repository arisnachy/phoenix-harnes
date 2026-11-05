import { genesisDatabasePath } from './phoenix-genesis-paths.mjs'
/**
 * Genesis offline institutional register. The operator supplies only
 * authorized files. No network discovery, upload or LLM processing occurs.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GenesisInstitutionalRegistry } from './phoenix-genesis-institutional-registry.mjs'

export function runGenesisRegistryCli(argv,dbPath){
  const store=new GenesisInstitutionalRegistry(dbPath)
  try{
    const [action,...rest]=argv
    if(action==='init'&&rest.length===1)
      return store.registerOrganization(JSON.parse(readFileSync(rest[0],'utf8')))
    if(action==='evidence'&&rest.length>=3&&rest.length<=4)
      return store.registerEvidence({organizationId:rest[0],
        filePath:rest[1],kind:rest[2],validated:rest[3]==='validated'})
    if(action==='resource'&&rest.length===1)
      return store.addResource(JSON.parse(readFileSync(rest[0],'utf8')))
    if(action==='measure'&&rest.length===1)
      return store.recordIndicator(JSON.parse(readFileSync(rest[0],'utf8')))
    if(action==='poa'&&rest.length===1)
      return store.draftPOA(JSON.parse(readFileSync(rest[0],'utf8')))
    if(action==='snapshot'&&rest.length===1)
      return store.snapshot(rest[0])
    throw Error('Uso: init <spec.json> | evidence <org> <file> <kind> [validated] | '+
      'resource <json> | measure <json> | poa <json> | snapshot <org>')
  }finally{store.close()}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  try{
    const result=runGenesisRegistryCli(process.argv.slice(2),
      genesisDatabasePath())
    process.stdout.write(JSON.stringify(result,null,2)+'\n')
  }catch(error){console.error('Genesis: '+error.message);process.exitCode=1}
}
