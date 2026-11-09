import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {encryptCloudTicket,decryptCloudTicket,enrollCloudTicket,CLOUD_ISSUE_TITLE,
  CLOUD_BODY_PREFIX} from '../src/sports-cloud-ticket.ts'
const key=randomBytes(32).toString('base64url')
const ticket={version:1,kind:'research',reference:'PHX-ABC123',
  createdAt:'2026-11-09T14:00:00Z',
  legs:Array.from({length:5},(_,i)=>({
    sport:'basketball',league:'nba',eventId:String(100+i),
    date:'2026-11-09',market:'winner',selection:'home',
  })),
}
test('encrypted ticket round-trip has no plaintext ticket or recipient in public issue body',()=>{
  const payload=encryptCloudTicket(ticket,key)
  assert.equal(typeof payload,'string')
  assert.ok(!payload.includes(ticket.reference))
  assert.deepEqual(decryptCloudTicket(payload,key),ticket)
  assert.throws(()=>decryptCloudTicket(payload,randomBytes(32).toString('base64url')))
})
test('tampering with one encrypted byte breaks authentication',()=>{
  const value=encryptCloudTicket(ticket,key)
  const bytes=Buffer.from(value,'base64url')
  bytes[bytes.length-1]^=1
  assert.throws(()=>decryptCloudTicket(bytes.toString('base64url'),key))
})
test('cloud enrollment cannot publish anything without explicit opt-in and both credentials',async()=>{
  let calls=0
  const fake=async()=>{calls++;throw Error('must not call')}
  const a=await enrollCloudTicket(ticket,{},fake)
  assert.equal(a.status,'disabled')
  const b=await enrollCloudTicket(ticket,{
    PHOENIX_SPORTS_CLOUD_TRACKING_ENABLED:'1'
  },fake)
  assert.equal(b.status,'needs-configuration')
  assert.equal(calls,0)
})
test('opted-in enrollment sends only authenticated ciphertext to the fixed GitHub host',async()=>{
  let transmitted
  const mock=async(url,init)=>{
    transmitted={url,init}
    return new Response(JSON.stringify({number:3501}),{status:201,
      headers:{'Content-Type':'application/json'}})
  }
  const result=await enrollCloudTicket(ticket,{
    PHOENIX_SPORTS_CLOUD_TRACKING_ENABLED:'1',
    PHOENIX_SPORTS_CLOUD_GITHUB_TOKEN:'test-GH-token',
    PHOENIX_SPORTS_CLOUD_AES_KEY:key,
  },mock)
  assert.equal(result.status,'enqueued')
  assert.equal(result.issueNumber,3501)
  assert.equal(transmitted.url,'https://api.github.com/repos/arisnachy/phoenix-harnes/issues')
  const body=JSON.parse(transmitted.init.body)
  assert.equal(body.title,CLOUD_ISSUE_TITLE)
  assert.ok(body.body.startsWith(CLOUD_BODY_PREFIX))
  assert.ok(!body.body.includes(ticket.reference))
  assert.ok(!JSON.stringify(result).includes('test-GH-token'))
})
