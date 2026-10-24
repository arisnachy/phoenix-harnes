/**
 * Validate the actual Phoenix Vite distribution, not just source TypeScript.
 * Source tests can pass while the served dist is stale or built from another
 * worktree. This check runs AFTER a clean web build in GitHub Actions.
 */
import {readFile,readdir,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../apps/web/dist/',import.meta.url))

export async function inspectBuiltSportsFrontend(directory=root){
  const html=await readFile(join(directory,'index.html'),'utf8')
  if(!html.includes('<html')&&!html.includes('<!doctype html'))throw new Error('Invalid Vite index.html')
  const assets=join(directory,'assets'),files=await readdir(assets,{recursive:true})
  let source=''
  for(const file of files){
    if(typeof file!=='string'||!file.endsWith('.js'))continue
    const path=join(assets,file)
    if(!(await stat(path)).isFile())continue
    source+=await readFile(path,'utf8')
  }
  const contracts=['sports_game_card','sports_ticket_card','sports-evidence']
  const missing=contracts.filter(s=>!source.includes(s))
  if(missing.length)throw new Error('Phoenix web bundle no contiene el renderizador deportivo: '+missing.join(', '))
  return {files:files.filter(f=>f.endsWith('.js')).length,contracts}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  inspectBuiltSportsFrontend().then(r=>console.log('[PHOENIX] Bundle deportivo listo:',r),e=>{console.error('[PHOENIX] '+e.message);process.exitCode=1})
}
