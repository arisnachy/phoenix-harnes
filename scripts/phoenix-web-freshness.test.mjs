import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {checkoutRevision,frontendIsCurrent,sportsClientBundleReady,verifyFrontend} from './phoenix-web-freshness.mjs'

const FIRST='a'.repeat(40)
const SECOND='b'.repeat(40)
async function directory(t){
  const root=await mkdtemp(join(tmpdir(),'phoenix-frontend-freshness-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  return root
}
test('validates Git SHA without trusting arbitrary stdout',()=>{
  assert.equal(checkoutRevision('/tmp',()=>FIRST+'\n'),FIRST)
  assert.equal(checkoutRevision('/tmp',()=> 'bad\n'),null)
  assert.equal(checkoutRevision('/tmp',()=>{throw Error('git missing')}),null)
})
test('rebuilds missing dist, stamps successful revision and skips repeat launch',async t=>{
  const root=await directory(t)
  const index=join(root,'apps/web/dist/index.html'),commands=[]
  const readRevision=()=>FIRST
  // Build runner is injected so tests cannot execute pnpm or touch production.
  const one=verifyFrontend({root,readRevision,build:args=>{
    commands.push(args.join(' '))
    if(args[1]==='build:web'){
      mkdirSync(dirname(index),{recursive:true});writeFileSync(index,'<!doctype html>')
      const plugin=join(root,'packages/client/ui-conversation/lib/client.js')
      mkdirSync(dirname(plugin),{recursive:true})
      writeFileSync(plugin,'sports_game_card sports_ticket_card sports-evidence')
    }
    return 0
  }})
  assert.equal(one.status,'rebuilt')
  assert.deepEqual(commands,['run build:lib:host','run build:lib:client','run build:web'])
  assert.equal(frontendIsCurrent(root,FIRST),true)
  assert.equal(sportsClientBundleReady(root),true)
  writeFileSync(join(root,'packages/client/ui-conversation/lib/client.js'),'obsolete')
  assert.equal(frontendIsCurrent(root,FIRST),false)
  writeFileSync(join(root,'packages/client/ui-conversation/lib/client.js'),'sports_game_card sports_ticket_card sports-evidence')
  assert.equal(verifyFrontend({root,readRevision,build:()=>{throw Error('unexpected rebuild')}}).status,'current')
})
test('revision mismatch never serves obsolete frontend and restamps only after build',async t=>{
  const root=await directory(t),base=join(root,'apps/web/dist')
  await mkdir(base,{recursive:true})
  await writeFile(join(base,'index.html'),'<html></html>')
  await writeFile(join(base,'.phoenix-web-source-revision.json'),JSON.stringify({revision:FIRST,successful:true}))
  assert.equal(frontendIsCurrent(root,SECOND),false)
  assert.throws(()=>verifyFrontend({root,readRevision:()=>SECOND,skip:true,build:()=>0}),/anterior/)
  assert.throws(()=>verifyFrontend({root,readRevision:()=>SECOND,build:()=>1}),/Falló/)
  const marker=JSON.parse(await readFile(join(base,'.phoenix-web-source-revision.json'),'utf8'))
  assert.equal(marker.revision,FIRST)
})
test('packaged installs without .git keep their dist; no dist is never treated as usable',async t=>{
  const root=await directory(t),base=join(root,'apps/web/dist')
  await mkdir(base,{recursive:true})
  await writeFile(join(base,'index.html'),'<html></html>')
  assert.equal(verifyFrontend({root,readRevision:()=>null,build:()=>{throw Error('No build!')}}).status,'packaged')
  await rm(join(base,'index.html'))
  assert.throws(()=>verifyFrontend({root,readRevision:()=>null}),/no tiene frontend/)
})
