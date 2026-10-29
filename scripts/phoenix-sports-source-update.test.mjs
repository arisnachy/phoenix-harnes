import {test} from 'node:test'
import assert from 'node:assert/strict'
import {homedir} from 'node:os'
import {join,resolve} from 'node:path'
import {SPORTS_INSTALL_VERSION,ODDSHARVESTER_VERSION,verifyManifestShape,
  pythonCompatible,pythonCandidates,
  status as installerStatus} from './phoenix-sports-source-bootstrap.mjs'
import {resolveSportsInstaller,shouldBootstrap,start} from './phoenix-sports-source-auto.mjs'
const prefix=resolve(process.env.PHOENIX_SPORTS_SOURCE_HOME||join(homedir(),'.phoenix','sports-sources'))
const cli=process.platform==='win32'
  ?join(prefix,'.venv','Scripts','oddsharvester.exe')
  :join(prefix,'.venv','bin','oddsharvester')
const full={schema:3,updatedAt:new Date().toISOString(),paths:{
  executable:cli,history:join(prefix,'history'),
},components:{
  'OddsHarvester + Playwright':{status:'installed'},
  'SportsbookReview NFL/NBA/NHL/MLB archive':{status:'installed'},
  'MLB historic dataset and scraper sources':{status:'installed'},
}}
test('managed three-source manifest has pinned schema, wheel and paths',()=>{
  assert.equal(SPORTS_INSTALL_VERSION,3)
  assert.equal(ODDSHARVESTER_VERSION,'0.20.0')
  assert.equal(verifyManifestShape(full),true)
  assert.equal(verifyManifestShape({...full,paths:{...full.paths,executable:'/tmp/evil'}}),false)
  assert.equal(verifyManifestShape({...full,schema:10}),false)
})
test('idempotent update skips a healthy manifest and throttles transient failures',()=>{
  const t=Date.parse('2026-10-29T15:00:00Z')
  assert.equal(shouldBootstrap({...full,updatedAt:new Date(t).toISOString()},t),false)
  const broken={...full,updatedAt:new Date(t).toISOString(),components:{
    ...full.components,'MLB historic dataset and scraper sources':{status:'error'},
  }}
  assert.equal(shouldBootstrap(broken,t+500),false)
  assert.equal(shouldBootstrap(broken,t+3600001),true)
  assert.equal(shouldBootstrap(null,t),true)
  assert.equal(shouldBootstrap({...full,schema:2},t),true)
})
test('status probe does not perform network installs or leak credentials',async()=>{
  const report=await installerStatus()
  assert.equal(typeof report.configured,'boolean')
  assert.equal(typeof report.executable,'boolean')
  assert.ok(!JSON.stringify(report).includes('THE_ODDS_API_KEY'))
})

test('startup dispatches a detached worker without running installer inline',async()=>{
  const {mkdtempSync,rmSync,existsSync}=await import('node:fs')
  const {tmpdir}=await import('node:os')
  const home=mkdtempSync(join(tmpdir(),'phoenix-sports-startup-'))
  const priorHome=process.env.PHOENIX_SPORTS_SOURCE_HOME
  const priorOptOut=process.env.PHOENIX_SPORTS_SOURCES_AUTO_INSTALL
  try{
    process.env.PHOENIX_SPORTS_SOURCE_HOME=home
    delete process.env.PHOENIX_SPORTS_SOURCES_AUTO_INSTALL
    const {start}=await import('./phoenix-sports-source-auto.mjs?test='+Date.now())
    let launched=0,unrefCalled=false
    start((_bin,args,options)=>{
      launched++
      assert.deepEqual(args.slice(-1),['--worker'])
      assert.equal(options.detached,true)
      assert.equal(options.stdio,'ignore')
      return {unref(){unrefCalled=true}}
    },{PHOENIX_SPORTS_SOURCE_HOME:home})
    assert.equal(launched,1)
    assert.equal(unrefCalled,true)
    assert.equal(existsSync(join(home,'install.lock')),true)
  }finally{
    if(priorHome===undefined)delete process.env.PHOENIX_SPORTS_SOURCE_HOME
    else process.env.PHOENIX_SPORTS_SOURCE_HOME=priorHome
    if(priorOptOut===undefined)delete process.env.PHOENIX_SPORTS_SOURCES_AUTO_INSTALL
    else process.env.PHOENIX_SPORTS_SOURCES_AUTO_INSTALL=priorOptOut
    rmSync(home,{recursive:true,force:true})
  }
})

test('OddsHarvester requires Python >=3.12 and probes compatible Windows launchers',()=>{
  assert.equal(pythonCompatible([3,11,10]),false)
  assert.equal(pythonCompatible([3,12,1]),true)
  assert.equal(pythonCompatible([3,13,2]),true)
  assert.equal(pythonCompatible([2,99]),false)
  const candidates=pythonCandidates('win32')
  assert.ok(candidates.some(([bin,args])=>bin==='py'&&args[0]==='-3.12'))
  assert.ok(candidates.some(([bin,args])=>bin==='py'&&args[0]==='-3.13'))
  assert.ok(!candidates.some(([bin,args])=>bin==='py'&&args[0]==='-3.11'))
})
test('bootstrap CLI status reports archive coverage and log location for diagnosis',async()=>{
  const state=await installerStatus()
  assert.equal(Array.isArray(state.sports),true)
  assert.equal(state.sports.length,4)
  assert.equal(typeof state.mlbAvailable,'boolean')
  assert.ok(state.log.endsWith('install.log'))
})

test('Windows updater falls back to source checkout when prepared runtime has no scripts',async()=>{
  const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync}=await import('node:fs')
  const {tmpdir}=await import('node:os')
  const home=mkdtempSync(join(tmpdir(),'phoenix-sources-boot-fallback-'))
  const checkout=join(home,'checkout'),runtime=join(home,'prepared-runtime')
  const store=join(home,'sports')
  try{
    mkdirSync(join(checkout,'scripts'),{recursive:true})
    mkdirSync(runtime,{recursive:true})
    const source=join(checkout,'scripts','phoenix-sports-source-bootstrap.mjs')
    writeFileSync(source,'// test fixture only')
    const located=resolveSportsInstaller([runtime,checkout])
    assert.equal(located.root,checkout)
    let observed=null
    const result=start((binary,args,options)=>{
      observed={binary,args,options}
      return{unref(){}}
    },{PHOENIX_INSTALL_ROOT:checkout,PHOENIX_RUNTIME_ROOT:runtime,
      PHOENIX_SPORTS_SOURCE_HOME:store})
    assert.equal(result.status,'started')
    assert.equal(observed.options.cwd,checkout)
    assert.equal(observed.options.env.PHOENIX_SPORTS_BOOTSTRAP_ROOT,checkout)
    assert.equal(existsSync(join(store,'install.lock')),true)
    assert.match(readFileSync(join(store,'install.log'),'utf8'),/Launching background installer/)
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('explicit repair bypasses backoff but keeps the single installer lock',async()=>{
  const {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync}=await import('node:fs')
  const {tmpdir}=await import('node:os')
  const dir=mkdtempSync(join(tmpdir(),'phoenix-sports-retry-'))
  const checkout=join(dir,'checkout'),store=join(dir,'data')
  try{
    mkdirSync(join(checkout,'scripts'),{recursive:true})
    mkdirSync(store,{recursive:true})
    writeFileSync(join(checkout,'scripts','phoenix-sports-source-bootstrap.mjs'),'// fixture')
    writeFileSync(join(store,'manifest.json'),JSON.stringify({
      schema:3,updatedAt:new Date().toISOString(),
      components:{'OddsHarvester + Playwright':{status:'error'}},
    }))
    const env={PHOENIX_INSTALL_ROOT:checkout,PHOENIX_SPORTS_SOURCE_HOME:store}
    const launch=(_bin,_args,_options)=>({unref(){}})
    assert.equal(start(launch,env).status,'retry-cooldown')
    assert.equal(start(launch,env,{force:true}).status,'started')
    assert.equal(start(launch,env,{force:true}).status,'running')
    assert.equal(existsSync(join(store,'install.log')),true)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('asynchronous Windows worker launch failure is logged and does not strand the lock',async()=>{
  const {mkdtempSync,mkdirSync,readFileSync,existsSync,rmSync}=await import('node:fs')
  const {tmpdir}=await import('node:os')
  const {EventEmitter}=await import('node:events')
  const root=mkdtempSync(join(tmpdir(),'phoenix-sports-launch-error-'))
  const store=join(root,'sources')
  try{
    mkdirSync(store,{recursive:true})
    const env={PHOENIX_INSTALL_ROOT:resolve('.'),
      PHOENIX_SPORTS_SOURCE_HOME:store}
    const child=new EventEmitter()
    child.unref=()=>{}
    const result=start(()=>child,env)
    assert.equal(result.status,'started')
    child.emit('error',Error('spawn EPERM'))
    assert.equal(existsSync(join(store,'install.lock')),false)
    assert.match(readFileSync(join(store,'install.log'),'utf8'),/spawn EPERM/)
  }finally{rmSync(root,{recursive:true,force:true})}
})
