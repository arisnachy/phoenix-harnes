// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AdaptiveAppProposal, parseAdaptiveAppProposal } from '../src/client/chat/AdaptiveAppProposal.tsx'

afterEach(() => cleanup())

const proposal = () => ({
  component: 'adaptive_app',
  version: 1,
  props: {
    title: 'Inventario farmacia',
    description: 'Gestión de productos y compras.',
    sections: ['Inicio', 'Productos', 'Proveedores', 'Reportes'],
  },
})

describe('App Studio model proposal', () => {
  it('accepts bounded data and rejects arbitrary URLs, handlers and duplicate menus', () => {
    expect(parseAdaptiveAppProposal(proposal())?.props.sections).toHaveLength(4)
    expect(parseAdaptiveAppProposal({ ...proposal(), props: {
      ...proposal().props, onClick: 'execute()',
    } })).toBeNull()
    expect(parseAdaptiveAppProposal({ ...proposal(), props: {
      ...proposal().props, sections: ['Inicio', 'inicio'],
    } })).toBeNull()
    expect(parseAdaptiveAppProposal({ ...proposal(), props: {
      ...proposal().props, sections: Array.from({ length: 13 }, (_, i) => String(i)),
    } })).toBeNull()
    expect(parseAdaptiveAppProposal({ ...proposal(), script: 'fetch(...)' })).toBeNull()
  })

  it('installs only on a user gesture and waits for a matching acknowledgment', () => {
    const spec = parseAdaptiveAppProposal(proposal())!
    const events: Array<{requestId:string;title:string;sections:string[]}> = []
    const onInstall = (event: Event): void => {
      events.push((event as CustomEvent).detail)
    }
    window.addEventListener('phoenix:adaptive-app-install', onInstall)
    try {
      render(<AdaptiveAppProposal spec={spec}/>)
      expect(events).toHaveLength(0)
      const button = screen.getByRole('button', { name: 'Añadir a mis aplicaciones' })
      fireEvent.click(button)
      expect(events).toHaveLength(1)
      expect(events[0]?.title).toBe('Inventario farmacia')
      fireEvent(window, new CustomEvent('phoenix:adaptive-app-install-result', {
        detail: { requestId: 'wrong', ok: true },
      }))
      expect(screen.getByText('Guardando...')).toBeTruthy()
      fireEvent(window, new CustomEvent('phoenix:adaptive-app-install-result', {
        detail: { requestId: events[0]!.requestId, ok: true },
      }))
      expect(screen.getByText('Añadida a mis aplicaciones')).toBeTruthy()
      expect(button.hasAttribute('disabled')).toBe(true)
    } finally {
      window.removeEventListener('phoenix:adaptive-app-install', onInstall)
    }
  })
})
