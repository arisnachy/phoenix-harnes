// @vitest-environment jsdom
import {describe,it,expect} from 'vitest'
import {activateSheetContext,disconnectSheetContext,prepareSheetPrompt,consumeSheetGrant,revokeSheetGrant} from '../src/client/chat/active-sheet-context.ts'
describe('active sheet capability and replay protection',()=>{
  it('captures current cells and authorizes one exact session/revision only',()=>{
    let revision=3
    activateSheetContext('session-a','owner',()=>({id:'budget',title:'Budget',revision,selection:'B2',columns:['A','B'],rows:[['Food','900']]}))
    try{
      const grant=prepareSheetPrompt('session-a','Edit the budget')!
      expect(grant.text).toContain('"rows":[["Food","900"]]')
      expect(consumeSheetGrant('session-b','budget',3,grant.token)).toBe(false)
      expect(consumeSheetGrant('session-a','other',3,grant.token)).toBe(false)
      revision=4
      expect(consumeSheetGrant('session-a','budget',3,grant.token)).toBe(false)
      const next=prepareSheetPrompt('session-a','Edit the latest budget')!
      expect(consumeSheetGrant('session-a','budget',4,grant.token)).toBe(false)
      expect(consumeSheetGrant('session-a','budget',4,next.token)).toBe(true)
      expect(consumeSheetGrant('session-a','budget',4,next.token)).toBe(false)
      const revoked=prepareSheetPrompt('session-a','Edit')!
      revokeSheetGrant('session-a',revoked.token)
      expect(consumeSheetGrant('session-a','budget',4,revoked.token)).toBe(false)
    }finally{disconnectSheetContext('session-a','owner')}
  })
  it('does not attach content after the owner disconnects',()=>{
    activateSheetContext('session-x','owner',()=>({id:'budget',title:'Budget',revision:0,selection:'A2',columns:['A'],rows:[['x']]}))
    disconnectSheetContext('session-x','owner')
    expect(prepareSheetPrompt('session-x','Hello')).toBeUndefined()
  })
})
