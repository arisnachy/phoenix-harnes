// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UniversalArtifactSurface } from '../src/client/chat/UniversalArtifactSurface.tsx'
import { normalizeHardnessArtifact } from '../src/client/artifact.ts'
import * as library from '../src/client/chat/game-library.ts'

vi.mock('../src/client/chat/game-library.ts', () => ({
  libraryGameId: (title: string) => title.toLowerCase(),
  saveLibraryGame: vi.fn(async () => {}),
  listLibraryGames: vi.fn(async () => []),
  removeLibraryGame: vi.fn(async () => {}),
  openGameInWindow: vi.fn(),
}))

const game = '<html><body><canvas></canvas><script>document.body.dataset.playing="yes"</script></body></html>'

function mountGame() {
  return render(<UniversalArtifactSurface artifact={normalizeHardnessArtifact({
    id: 'sample', title: 'La Cripta Carmesí', mime: 'application/vnd.phoenix.game+html',
    data: game,
  })} onStop={() => {}} />)
}

beforeEach(() => {
  vi.mocked(library.saveLibraryGame).mockReset().mockResolvedValue(undefined)
  vi.mocked(library.listLibraryGames).mockReset().mockResolvedValue([])
  vi.mocked(library.removeLibraryGame).mockReset().mockResolvedValue(undefined)
  vi.mocked(library.openGameInWindow).mockReset()
})
afterEach(() => { cleanup() })

describe('Game Studio presentation and library actions', () => {
  it('shows only one game title, concise actions and its isolated preview', () => {
    const view = mountGame()
    expect(screen.getAllByRole('heading', { name: 'La Cripta Carmesí' })).toHaveLength(1)
    expect(view.container.querySelector('[data-game-preflight]')?.getAttribute('data-game-preflight')).toBe('needs-repair')
    expect(screen.queryByText(/preflight|review required|Issues:|Review:/iu)).toBeNull()
    expect(screen.getByRole('button', { name: 'Agregar a biblioteca' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Abrir biblioteca' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Abrir en otra ventana' })).toBeTruthy()
    const frame = screen.getByTitle('La Cripta Carmesí')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain("connect-src 'none'")
  })

  it('saves the game and opens a library where saved games can launch or be removed', async () => {
    vi.mocked(library.listLibraryGames).mockResolvedValue([{
      id: 'la cripta carmesí', title: 'La Cripta Carmesí', html: game, updatedAt: 1,
    }])
    mountGame()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar a biblioteca' }))
    await waitFor(() => {
      expect(library.saveLibraryGame).toHaveBeenCalledWith('La Cripta Carmesí', game)
      expect(screen.getByRole('button', { name: 'Guardado en biblioteca' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir biblioteca' }))
    await waitFor(() => { expect(screen.getByRole('dialog', { name: 'Biblioteca de juegos' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Jugar' }))
    expect(library.openGameInWindow).toHaveBeenCalledWith(
      'La Cripta Carmesí', expect.stringContaining("connect-src 'none'"),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar La Cripta Carmesí de la biblioteca' }))
    await waitFor(() => { expect(library.removeLibraryGame).toHaveBeenCalledWith('la cripta carmesí') })
  })

  it('opens the current game separately and does not falsely confirm failed saves', async () => {
    vi.mocked(library.saveLibraryGame).mockRejectedValueOnce(new Error('Espacio insuficiente'))
    mountGame()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir en otra ventana' }))
    expect(library.openGameInWindow).toHaveBeenCalledWith(
      'La Cripta Carmesí', expect.stringContaining("connect-src 'none'"),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Agregar a biblioteca' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Espacio insuficiente') })
    expect(screen.getByRole('button', { name: 'Agregar a biblioteca' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Guardado en biblioteca' })).toBeNull()
  })
})
