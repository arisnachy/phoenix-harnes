// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AdaptiveFormProposal, parseAdaptiveFormProposal } from '../src/client/chat/AdaptiveFormProposal.tsx'

const proposal = () => ({
  component: 'adaptive_form', version: 1,
  props: {
    appId: 'app-inventario', sectionId: 'productos',
    fields: [
      { label: 'Existencias', kind: 'number', destination: 'local', output: 'table' },
      { label: 'Código', kind: 'text', destination: 'api', output: 'inline' },
    ],
  },
})
afterEach(() => cleanup())
describe('chat-authored form proposal', () => {
  it('rejects executable capabilities and unknown extensions', () => {
    expect(parseAdaptiveFormProposal(proposal())?.props.fields).toHaveLength(2)
    expect(parseAdaptiveFormProposal({ ...proposal(), props: {
      ...proposal().props, code: 'executeUnsafe()',
    } })).toBeNull()
    expect(parseAdaptiveFormProposal({ ...proposal(), props: {
      ...proposal().props, fields: [{ ...proposal().props.fields[0], endpoint: 'https://bad.example' }],
    } })).toBeNull()
    expect(parseAdaptiveFormProposal({ ...proposal(), props: {
      ...proposal().props, appId: 'healthia',
    } })).toBeNull()
  })
  it('emits a schema-only request after user approval, not on render', () => {
    const requests: unknown[] = []
    const onRequest = (event: Event) => { requests.push((event as CustomEvent).detail) }
    window.addEventListener('phoenix:adaptive-form-install', onRequest)
    try {
      render(<AdaptiveFormProposal spec={parseAdaptiveFormProposal(proposal())!}/>)
      expect(requests).toHaveLength(0)
      fireEvent.click(screen.getByRole('button', { name: 'Aplicar campos al formulario' }))
      expect(requests).toHaveLength(1)
      const data = requests[0] as { requestId: string; fields: unknown[] }
      expect(data.fields).toHaveLength(2)
      expect(JSON.stringify(data)).not.toMatch(/patientName|password|secretData/u)
      fireEvent(window, new CustomEvent('phoenix:adaptive-form-install-result', {
        detail: { requestId: data.requestId, ok: true },
      }))
      expect(screen.getByRole('button', { name: 'Estructura aplicada' })).toBeTruthy()
    } finally { window.removeEventListener('phoenix:adaptive-form-install', onRequest) }
  })
})
