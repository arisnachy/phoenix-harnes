// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BusinessLibrarySettingsTab, type BusinessLibrarySettingsTabProps } from '../src/client/BusinessLibrarySettingsTab.tsx'
import { es } from '../src/client/locales.ts'

afterEach(cleanup)
const translations = { t: (key:keyof typeof es) => es[key] }
const novel = {
  id:'la-novela-1',title:'La novela del abismo',type:'book',updatedAt:'2026-10-17',
  fileCount:3,chapterCount:8,listingCount:1,plannedChapters:24,writtenWords:20000,
  targetWords:65000,buildStatus:'stale' as const,listingStage:'review-required' as const,
}
const software = {
  id:'software-1',title:'Panel de turnos',type:'software',updatedAt:'2026-10-16',
  fileCount:2,chapterCount:0,listingCount:0,plannedChapters:0,writtenWords:0,
  targetWords:null,buildStatus:'not-built' as const,listingStage:'not-prepared' as const,
}
function props(readBusinessLibrary: () => Promise<unknown>) {
  return { ...translations, readBusinessLibrary } as unknown as BusinessLibrarySettingsTabProps
}
describe('Mi Biblioteca tab', () => {
  it('displays host products and filters them without claiming publication', async () => {
    const read = vi.fn().mockResolvedValue({totalCount:2,truncated:false,products:[novel,software]})
    render(<BusinessLibrarySettingsTab {...props(read)} />)
    expect(await screen.findByText('La novela del abismo')).toBeTruthy()
    expect(screen.getByText('Panel de turnos')).toBeTruthy()
    expect(screen.getByText('Preparar una ficha no significa que el producto esté publicado ni vendido.')).toBeTruthy()
    expect(screen.getByText('Exportación desactualizada')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'),{target:{value:'turnos'}})
    expect(screen.queryByText('La novela del abismo')).toBeNull()
    expect(screen.getByText('Panel de turnos')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'),{target:{value:''}})
    fireEvent.change(screen.getByRole('combobox'),{target:{value:'book'}})
    expect(screen.getByText('La novela del abismo')).toBeTruthy()
    expect(screen.queryByText('Panel de turnos')).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Actualizar'}))
    await waitFor(()=>expect(read).toHaveBeenCalledTimes(2))
  })
  it('includes commercial services and filters them without reporting sales', async () => {
    const service = { ...software, id: 'service-1', title: 'Consultoría profesional', type: 'service' as const }
    const read = vi.fn().mockResolvedValue({totalCount:2,truncated:false,products:[software,service]})
    render(<BusinessLibrarySettingsTab {...props(read)} />)
    expect(await screen.findByText('Consultoría profesional')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox'), {target:{value:'service'}})
    expect(screen.getByText('Consultoría profesional')).toBeTruthy()
    expect(screen.queryByText('Panel de turnos')).toBeNull()
    expect(screen.getByText('Preparar una ficha no significa que el producto esté publicado ni vendido.')).toBeTruthy()
  })
  it('shows errors without showing fictitious content', async () => {
    const read = vi.fn().mockRejectedValue(new Error('File locked'))
    render(<BusinessLibrarySettingsTab {...props(read)} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Panel de turnos')).toBeNull()
  })
})