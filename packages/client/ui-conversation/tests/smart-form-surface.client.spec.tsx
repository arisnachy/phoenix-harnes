// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SmartFormWorkspace } from '../src/client/chat/SmartFormSurface.tsx'
import { starterForms } from '../src/client/chat/SmartFormLibrary.ts'

afterEach(()=>{cleanup();localStorage.clear()})

describe('native smart form interaction',()=>{
  it('calculates in place, saves the definition and archives an explicitly consented result',()=>{
    render(<SmartFormWorkspace initial={starterForms[0]!}/>)
    fireEvent.change(screen.getByLabelText(/Peso/),{target:{value:'72'}})
    fireEvent.change(screen.getByLabelText(/Estatura/),{target:{value:'180'}})
    expect(screen.getByText(/22,2/)).not.toBeNull()
    expect(screen.getByRole('button',{name:/Guardar resultado/}).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button',{name:/Guardar plantilla/}))
    expect(screen.getByRole('status').textContent).toContain('revisión 1')
    fireEvent.click(screen.getByRole('checkbox',{name:/Autorizo guardar/}))
    fireEvent.click(screen.getByRole('button',{name:/Guardar resultado/}))
    expect(screen.getByRole('status').textContent).toContain('Historial')
    fireEvent.click(screen.getByRole('button',{name:/Resultados \(1\)/}))
    expect(screen.getByText(/IMC:/)).not.toBeNull()
  })
  it('sends a user-triggered analysis as draft, never on every keystroke',()=>{
    const onAction=vi.fn()
    render(<SmartFormWorkspace initial={starterForms[0]!} onAction={onAction}/>)
    fireEvent.change(screen.getByLabelText(/Peso/),{target:{value:'80'}})
    fireEvent.change(screen.getByLabelText(/Estatura/),{target:{value:'180'}})
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:/Analizar con Kira/}))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction.mock.calls[0]?.[1]).toBe('draft')
    expect(onAction.mock.calls[0]?.[0]).toContain('calculadora_imc')
  })
  it('opens the searchable built-in library without server calls',()=>{
    render(<SmartFormWorkspace/>)
    expect(screen.getByText('Calculadora científica')).not.toBeNull()
    fireEvent.change(screen.getByRole('searchbox',{name:/Buscar formularios/}),{target:{value:'Obstetricia'}})
    expect(screen.getByText('Edad gestacional desde FUM')).not.toBeNull()
    expect(screen.queryByText('Calculadora científica')).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Abrir'}))
    expect(screen.getByText('Primer día de la última menstruación')).not.toBeNull()
  })
})
