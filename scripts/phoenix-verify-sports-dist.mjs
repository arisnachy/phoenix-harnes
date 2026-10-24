/**
 * Phoenix's Vite dist is only the bootstrap shell. Conversation UI is served
 * separately through /plugins/@phoenix-ai/dsh-client-ui-conversation/client.js.
 * Verify that independently built plugin instead of searching the Vite shell
 * for sports_card strings (which would be a false failure).
 */
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const CONTRACTS=['sports_game_card','sports_ticket_card','sports-evidence']

export async function inspectBuiltSportsFrontend(directory=root){
  const html=await readFile(join(directory,'apps/web/dist/index.html'),'utf8')
  if(!html.toLowerCase().includes('<html')&&!html.toLowerCase().includes('<!doctype html'))throw new Error('Invalid Vite bootstrap')
  const pluginPath=join(directory,'packages/client/ui-conversation/lib/client.js')
  const plugin=await readFile(pluginPath,'utf8')
  const missing=CONTRACTS.filter(s=>!plugin.includes(s))
  if(missing.length)throw new Error('Phoenix conversation client plugin carece de contrato deportivo: '+missing.join(', ')+'. Recompila build:lib:client.')
  return {plugin:'@phoenix-ai/dsh-client-ui-conversation/client',contracts:CONTRACTS}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  inspectBuiltSportsFrontend().then(x=>console.log('[PHOENIX] Plugin deportivo integrado:',x),e=>{console.error('[PHOENIX] '+e.message);process.exitCode=1})
}
