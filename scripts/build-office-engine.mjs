/** Build a separate, local-only Office asset. Never break the base Phoenix build if optional engine is unavailable. */
import {mkdirSync,copyFileSync,existsSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const source=resolve(root,'scripts/office-engine')
const cache=resolve(root,'.cache/phoenix/office-engine-1.6.1')
const dest=resolve(root,'apps/web/dist/office-engine')
const required=process.env.PHOENIX_REQUIRE_OFFICE_ENGINE==='1'
function run(command,args,cwd,shell=false){
  const r=spawnSync(command,args,{cwd,shell,stdio:'inherit',timeout:240000,env:{...process.env,npm_config_audit:'false',npm_config_fund:'false',npm_config_ignore_scripts:'true'}})
  if(r.error||r.status!==0)throw Error('Office build command failed: '+command+' '+r.status)
}
try{
  mkdirSync(cache,{recursive:true})
  for(const f of ['package.json','index.html','entry.js'])copyFileSync(resolve(source,f),resolve(cache,f))
  const stamp=resolve(cache,'installed-manifest.json')
  const manifest=readFileSync(resolve(cache,'package.json'),'utf8')
  if(!existsSync(resolve(cache,'node_modules/@univerjs/preset-sheets-core/package.json'))||!existsSync(stamp)||readFileSync(stamp,'utf8')!==manifest){
    // Initial install resolves transitive dependencies; subsequent builds reuse its lock/cache.
    const npm=process.platform==='win32'?'npm.cmd':'npm'
    run(npm,[existsSync(resolve(cache,'package-lock.json'))?'ci':'install','--ignore-scripts','--no-audit','--no-fund'],cache,process.platform==='win32')
    writeFileSync(stamp,manifest)
  }
  const vite=resolve(root,'apps/web/node_modules/vite/bin/vite.js')
  run(process.execPath,[vite,'build',cache,'--base','./','--outDir',dest,'--emptyOutDir'],root)
  writeFileSync(resolve(dest,'ready.json'),JSON.stringify({engine:'univer',version:'1.6.1',protocol:1}))
  console.log('PHOENIX Office: local Univer asset built')
}catch(e){
  rmSync(dest,{recursive:true,force:true})
  console.error('PHOENIX Office: unavailable; basic editor remains usable.',e)
  if(required)process.exitCode=1
}
