import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli=fileURLToPath(new URL('./phoenix-social.mjs',import.meta.url))
async function fixture(fn) {
  const home=await mkdtemp(join(tmpdir(),'phoenix-social-test-'))
  const exec=(...args)=>{
    const r=spawnSync(process.execPath,[cli,...args],{
      encoding:'utf8',env:{...process.env,PHOENIX_SOCIAL_HOME:home,
        PHOENIX_SOCIAL_X_USER_TOKEN:'',PHOENIX_SOCIAL_INSTAGRAM_TOKEN:'',
        PHOENIX_SOCIAL_YOUTUBE_ACCESS_TOKEN:'',PHOENIX_SOCIAL_FACEBOOK_PAGE_TOKEN:''}})
    let body
    try{body=JSON.parse((r.status===0?r.stdout:r.stderr).trim())}
    catch(e){throw Error('Invalid CLI JSON: '+(r.stderr||r.stdout))}
    return {...body,status:r.status}
  }
  try{await fn({home,exec})}finally{await rm(home,{recursive:true,force:true})}
}
test('Phoenix identity is declared, never represented as registered externally',()=>fixture(async({exec})=>{
  const init=exec('init')
  assert.equal(init.ok,true)
  assert.equal(init.result.brand.id,'phoenix')
  assert.equal(init.result.accountsActuallyCreated,0)
  assert.equal(exec('init').ok,true)
  assert.equal(exec('brands').result.length,1)
  assert.equal(exec('account-plan','instagram').result.api,true)
  assert.match(exec('account-plan','tiktok').result.requirement,/TikTok/)
  assert.equal(exec('accounts').result.length,0)
}))
test('Campaign UTM, durable drafts, policy gates and auditable approvals',()=>fixture(async({exec,home})=>{
  exec('init')
  const c=exec('campaign','phoenix','Lanzamiento libro','https://example.org/obra').result
  assert.equal(c.paidPromotion,false)
  const d=exec('draft','phoenix','x','Presentación original','--campaign',c.id).result
  assert.equal(d.state,'draft')
  assert.match(d.link,/utm_source=x/)
  assert.equal(exec('publish',d.id,'--confirm',d.checksum).ok,false)
  assert.equal(exec('approve',d.id).ok,false)
  const accepted=exec('approve',d.id,'--by','Titular').result
  assert.equal(accepted.status,'approved')
  assert.equal(exec('publish',d.id,'--confirm','incorrecto').ok,false)
  assert.equal(exec('publish',d.id,'--confirm',d.checksum).ok,false)
  assert.equal(exec('show',d.id).result.state,'approved')
  assert.equal(exec('report').result.counts.approved,1)
  const db=await readFile(join(home,'social.json'),'utf8')
  assert.doesNotMatch(db,/access_token|refresh_token|PHOENIX_SOCIAL_X_USER_TOKEN/)
  assert.ok(exec('audit').result.some(x=>x.action==='approval-recorded'))
}))
test('Unverified account is never treated as connected; OAuth probe fails closed',()=>fixture(async({exec})=>{
  exec('init')
  const recorded=exec('account-register','phoenix','x','PhoenixAI').result
  assert.equal(recorded.state,'pending-oauth')
  assert.equal(exec('account-verify','phoenix','x').ok,false)
  assert.equal(exec('accounts').result[0].state,'pending-oauth')
}))
test('Media and scheduling constraints block dangerous or incomplete changes',()=>fixture(async({exec})=>{
  exec('init')
  assert.equal(exec('draft','phoenix','instagram','Sin imagen').ok,false)
  assert.equal(exec('draft','phoenix','youtube','Sin video').ok,false)
  assert.equal(exec('campaign','phoenix','Mala','http://localhost/internal').ok,false)
  assert.equal(exec('draft','phoenix','x','x'.repeat(281)).ok,false)
  const p=exec('draft','phoenix','x','Aprobado y programado').result
  assert.equal(exec('schedule',p.id,'2027-11-04T12:00:00Z').ok,false)
  exec('approve',p.id,'--by','Titular')
  assert.equal(exec('schedule',p.id,'2020-01-01T10:00:00Z').ok,false)
  const scheduled=exec('schedule',p.id,'2099-01-01T10:00:00Z').result
  assert.equal(scheduled.status,'scheduled')
  assert.equal(exec('run-due').result.executed,0)
  assert.equal(exec('posts').result[0].state,'scheduled')
}))
