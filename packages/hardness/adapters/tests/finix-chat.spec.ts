import { describe, expect, it } from 'vitest'
import { parseFinixChat } from '../src/proactivity-rpc-input.ts'
describe('Finix direct chat admission', () => {
  it('targets the actual conversation, using the host clock and local route', () => {
    expect(parseFinixChat({sessionId:'session-1',instruction:'Hola'},0)).toMatchObject({
      targetAgentId:'session-1', instruction:'Hola', runAt:'1970-01-01T00:00:00.000Z',
      createdBy:'user', executionPolicy:'companion-local', delivery:'work', attentionMode:'result',
    })
  })
  it('rejects attempts to supply a provider, external delivery, or an empty message', () => {
    expect(() => parseFinixChat({sessionId:'session-1',instruction:'Hola',provider:'remote'})).toThrow()
    expect(() => parseFinixChat({sessionId:'session-1',instruction:'Hola',delivery:'email'})).toThrow()
    expect(() => parseFinixChat({sessionId:'../x',instruction:'Hola'})).toThrow()
    expect(() => parseFinixChat({sessionId:'session-1',instruction:' '})).toThrow()
  })
})
