import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {sportsCredentialAsk} from '../src/sports-credential-ask.ts'

test('one optional Ask per provider per 30 days, safe registration link without secret',async()=>{
  const home=await mkdtemp(join(tmpdir(),'sports-key-ask-'))
  const env={PHOENIX_SPORTS_SOURCE_HOME:home}
  const now=Date.parse('2026-11-09T16:00:00Z')
  try{
    const first=await sportsCredentialAsk('request','THE_ODDS_API_KEY',env,now)
    assert.equal(first.status,'ask')
    assert.match(first.guideUrl,/the-odds-api\.com/)
    assert.deepEqual(first.options,['Configurar de forma segura','Ahora no','No volver a preguntar'])
    const second=await sportsCredentialAsk('request','THE_ODDS_API_KEY',env,now+60_000)
    assert.equal(second.status,'already-asked')
    const third=await sportsCredentialAsk('request','THE_ODDS_API_KEY',env,now+31*86_400_000)
    assert.equal(third.status,'ask')
    const json=JSON.stringify([first,second,third])
    assert.ok(!json.includes('secret-value'))
  }finally{await rm(home,{force:true,recursive:true})}
})

test('explicit do-not-ask preference persists per provider and globally',async()=>{
  const home=await mkdtemp(join(tmpdir(),'sports-key-optout-'))
  const env={PHOENIX_SPORTS_SOURCE_HOME:home}
  const now=Date.parse('2026-11-09T16:00:00Z')
  try{
    await sportsCredentialAsk('mute','THEODDSAPI_API_KEY',env,now)
    assert.equal((await sportsCredentialAsk('request','THEODDSAPI_API_KEY',env,now)).status,'suppressed')
    assert.equal((await sportsCredentialAsk('request','THE_ODDS_API_KEY',env,now)).status,'ask')
    await sportsCredentialAsk('mute-all',undefined,env,now)
    assert.equal((await sportsCredentialAsk('request','SPORTSGAMEODDS_API_KEY',env,now)).status,'suppressed')
    await sportsCredentialAsk('unmute-all',undefined,env,now)
    assert.equal((await sportsCredentialAsk('request','THERUNDOWN_API_KEY',env,now)).status,'ask')
    assert.equal((await sportsCredentialAsk('request','THEODDSAPI_API_KEY',env,now)).status,'suppressed')
    await sportsCredentialAsk('unmute','THEODDSAPI_API_KEY',env,now)
    assert.equal((await sportsCredentialAsk('request','THEODDSAPI_API_KEY',env,now)).status,'ask')
  }finally{await rm(home,{force:true,recursive:true})}
})

test('reject unknown provider refs and never accepts a key value',async()=>{
  const env={PHOENIX_SPORTS_SOURCE_HOME:join(tmpdir(),'unused')}
  await assert.rejects(()=>sportsCredentialAsk('request','KEY_VALUE_UNTRUSTED',env),
    /no admitida/)
  await assert.rejects(()=>sportsCredentialAsk('request',undefined,env),
    /referencia/)
})
