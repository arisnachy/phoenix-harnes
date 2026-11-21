import { describe, expect, it, vi } from 'vitest'
import { ADAPTIVE_ALLOW_ONCE, ADAPTIVE_DENY, confirmAdaptiveExternalAction, type AdaptiveApprovalService } from '../src/approved-action.ts'

const sample = {creationId:'app-inventory',action:'stock-adjust',inputJson:'{"quantity":2}'}
const answer = (selected:string[],automatic=false)=>({
  answers:[{id:'adaptive-external-action-confirm',selected}],automatic,
})
describe('one-time external tool approval', () => {
  it('refuses to act when there is no live human question provider', async () => {
    expect(await confirmAdaptiveExternalAction(sample)).toBe(false)
  })
  it('refuses timeout, cancellation, ambiguous responses and agent abort', async () => {
    for(const reply of [
      answer([ADAPTIVE_ALLOW_ONCE],true),
      answer([ADAPTIVE_DENY]),
      answer([]),
      answer([ADAPTIVE_ALLOW_ONCE,ADAPTIVE_DENY]),
    ]) {
      expect(await confirmAdaptiveExternalAction({...sample,ask:{ask:async()=>reply}})).toBe(false)
    }
    const controller = new AbortController()
    controller.abort()
    expect(await confirmAdaptiveExternalAction({
      ...sample,signal:controller.signal,
      ask:{ask:async()=>answer([ADAPTIVE_ALLOW_ONCE])},
    })).toBe(false)
  })
  it('approves exactly one user-confirmed action, with full input preview', async () => {
    const ask=vi.fn(async (_request: Parameters<AdaptiveApprovalService['ask']>[0])=>answer([ADAPTIVE_ALLOW_ONCE]))
    expect(await confirmAdaptiveExternalAction({...sample,ask:{ask}})).toBe(true)
    expect(ask).toHaveBeenCalledOnce()
    const sent=ask.mock.calls[0]?.[0]
    expect(sent.questions[0]?.sensitive).toBe(true)
    expect(sent.questions[0]?.detail).toContain('{"quantity":2}')
    expect(sent.questions[0]?.options[0]?.recommended).toBe(true)
    expect(sent.questions[0]?.options[0]?.label).toBe(ADAPTIVE_DENY)
  })
  it('fails closed on oversized inputs, unsafe names and provider failure', async () => {
    const ask=vi.fn(async (_request: Parameters<AdaptiveApprovalService['ask']>[0])=>answer([ADAPTIVE_ALLOW_ONCE]))
    expect(await confirmAdaptiveExternalAction({...sample,action:'../../bin/sh',ask:{ask}})).toBe(false)
    expect(await confirmAdaptiveExternalAction({...sample,inputJson:'x'.repeat(2001),ask:{ask}})).toBe(false)
    expect(await confirmAdaptiveExternalAction({...sample,ask:{ask:async()=>{throw new Error('offline')}}})).toBe(false)
    expect(ask).not.toHaveBeenCalled()
  })
})
