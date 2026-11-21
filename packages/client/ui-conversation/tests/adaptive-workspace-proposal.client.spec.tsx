// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  AdaptiveWorkspaceProposal, parseAdaptiveWorkspaceProposal,
} from '../src/client/chat/AdaptiveWorkspaceProposal.tsx'

afterEach(() => cleanup())
const valid = () => ({
  component:'adaptive_control',version:1,props:{
    appId:'app-inventario',operation:'palette',palette:'ocean',
  },
})
describe('chat-proposed UI self-change', () => {
  it('strictly validates operations, palettes, IDs and unknown keys', () => {
    expect(parseAdaptiveWorkspaceProposal(valid())?.props.palette).toBe('ocean')
    expect(parseAdaptiveWorkspaceProposal({...valid(), props:{...valid().props,style:'body {display:none}'}})).toBeNull()
    expect(parseAdaptiveWorkspaceProposal({...valid(),props:{...valid().props,palette:'url(https://evil.test)'}})).toBeNull()
    expect(parseAdaptiveWorkspaceProposal({...valid(),props:{...valid().props,appId:'healthia'}})).toBeNull()
    expect(parseAdaptiveWorkspaceProposal({...valid(),props:{...valid().props,operation:'eval'}})).toBeNull()
  })
  it('requires a successful preflight and another explicit click before applying', () => {
    const spec = parseAdaptiveWorkspaceProposal(valid())!
    const events: unknown[] = []
    const onRequest = (event: Event) => { events.push((event as CustomEvent).detail) }
    window.addEventListener('phoenix:adaptive-control-request',onRequest)
    try {
      render(<AdaptiveWorkspaceProposal spec={spec}/>)
      expect(events).toHaveLength(0)
      expect(screen.getByRole('button',{name:'Aplicar cambio verificado'}).hasAttribute('disabled')).toBe(true)
      fireEvent.click(screen.getByRole('button',{name:'Comprobar antes de aplicar'}))
      expect(events).toHaveLength(1)
      const first = events[0] as {requestId:string;phase:string;command:unknown}
      expect(first.phase).toBe('preflight')
      expect(screen.getByRole('button',{name:'Aplicar cambio verificado'}).hasAttribute('disabled')).toBe(true)
      fireEvent(window,new CustomEvent('phoenix:adaptive-control-result',{
        detail:{requestId:first.requestId,phase:'preflight',ok:true,reason:'APP_SCOPED_THEME'},
      }))
      expect(screen.getByRole('button',{name:'Aplicar cambio verificado'}).hasAttribute('disabled')).toBe(false)
      fireEvent.click(screen.getByRole('button',{name:'Aplicar cambio verificado'}))
      expect(events).toHaveLength(2)
      expect((events[1] as {phase:string}).phase).toBe('apply')
    } finally {window.removeEventListener('phoenix:adaptive-control-request',onRequest)}
  })
})
