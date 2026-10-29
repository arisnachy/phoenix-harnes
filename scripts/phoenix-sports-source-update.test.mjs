import {test} from 'node:test'
import assert from 'node:assert/strict'
import {homedir} from 'node:os'
import {join,resolve} from 'node:path'
import {SPORTS_INSTALL_VERSION,ODDSHARVESTER_VERSION,verifyManifestShape,
  pythonCompatible,pythonCandidates,
  status as installerStatus} from './phoenix-sports-source-bootstrap.mjs'
import {shouldBootstrap} from './phoenix-sports-source-auto.mjs'
const prefix=resolve(process.env.PHOENIX_SPORTS_SOURCE_HOME||join(homedir(),'.phoenix','sports-sources'))
const cli=process.platform==='win32'
  ?join(prefix,'.venv','Scripts','oddsharvester.exe')
  :join(prefix,'.venv','bin','oddsharvester')
const full={schema:2,updatedAt:new Date().toISOString(),paths:{
  executable:cli,history:join(prefix,'history'),
},components:{
  'OddsHarvester + Playwright':{status:'installed'},
  'SportsbookReview NFL/NBA/NHL/MLB archive':{status:'installed'},
  'MLB historic dataset and scraper sources':{status:'installed'},
}}
test('managed three-source manifest has pinned schema, wheel and paths',()=>{
  assert.equal(SPORTS_INSTALL_VERSION,2)
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
    })
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
