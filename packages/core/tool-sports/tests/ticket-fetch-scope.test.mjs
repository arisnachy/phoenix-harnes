import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createTicketFetchScope} from '../src/ticket-fetch-scope.ts'

test('ticket deadline aborts pending reads and caller cancellation still propagates',async()=>{
  const receivedSignals=[]
  const transport=async(_input,init)=>{
    receivedSignals.push(init.signal)
    return new Promise(resolve=>init.signal.addEventListener('abort',()=>{
      resolve(new Response('{}'))
    },{once:true}))
  }
  const scope=createTicketFetchScope(transport)
  const request=scope.fetcher('https://example.invalid/odds')
  await Promise.resolve()
  assert.equal(receivedSignals[0].aborted,false)
  scope.abort()
  assert.equal(receivedSignals[0].aborted,true)
  assert.equal((await request).status,200)

  const caller=new AbortController()
  const second=createTicketFetchScope(transport)
  const callerRequest=second.fetcher('https://example.invalid/odds',{
    signal:caller.signal,
  })
  await Promise.resolve()
  caller.abort()
  assert.equal(receivedSignals[1].aborted,true)
  assert.equal((await callerRequest).status,200)
})
