import { describe, expect, it } from 'vitest'
import { addGameReopenCards, isGameReopenPrompt } from '../src/client/chat/ToolActivityFlow.tsx'

function user(key: string, text: string) {
  return { key, kind: 'user', data: { content: [{ type: 'text', text }] } }
}

function game(key: string, title: string) {
  return {
    key, kind: 'hardness-artifact',
    data: {
      artifactId: key,
      title, mime: 'application/vnd.phoenix.game+html',
      data: '<html><canvas id="game"></canvas><script>start()</script></html>',
      executable: true,
    },
  }
}

describe('Game Studio durable in-chat reopen', () => {
  it('recognizes Spanish and English return-to-game gestures without generic game creation', () => {
    expect(isGameReopenPrompt('dejame verlo pacman')).toBe(true)
    expect(isGameReopenPrompt('Abre Pac-Man aquí para jugar')).toBe(true)
    expect(isGameReopenPrompt('Muéstrame el juego otra vez')).toBe(true)
    expect(isGameReopenPrompt('Show me Tetris')).toBe(true)
    expect(isGameReopenPrompt('haz un juego de carreras')).toBe(false)
    expect(isGameReopenPrompt('No abras el juego')).toBe(false)
  })

  it('mounts the exact existing Pac-Man artifact beside the follow-up, not the last different game', () => {
    const nodes = [
      game('game-pacman', 'Pac-Man: Laberinto Clásico'),
      game('game-snake', 'Snake'),
      user('user-1', 'dejame verlo pacman'),
    ]
    const items = addGameReopenCards([{ kind: 'node', key: 'user-1' }], nodes)
    expect(items).toEqual([
      { kind: 'node', key: 'user-1' },
      { kind: 'game-reopen', key: 'game-reopen:user-1', gameNodeKey: 'game-pacman' },
    ])
  })

  it('does not fabricate Pac-Man by reopening Snake or by trusting assistant prose', () => {
    const nodes = [game('game-snake', 'Snake'), user('user-2', 'quiero ver Pac-Man')]
    const items = addGameReopenCards([{ kind: 'node', key: 'user-2' }], nodes)
    expect(items).toEqual([
      { kind: 'node', key: 'user-2' },
      { kind: 'game-reopen', key: 'game-reopen:user-2' },
    ])
  })

  it('does not mount an extra copy if Phoenix really publishes the game in this turn', () => {
    const nodes = [
      user('user-3', 'muéstrame Pac-Man'),
      game('real-new-pacman', 'Pac-Man: Laberinto Clásico'),
    ]
    const items = addGameReopenCards([
      { kind: 'node', key: 'user-3' },
      { kind: 'node', key: 'real-new-pacman' },
    ], nodes)
    expect(items).toHaveLength(2)
    expect(items.some(item => item.kind === 'game-reopen')).toBe(false)
  })

  it('reopens the latest real game for generic return requests and supports optimistic sends', () => {
    const nodes = [game('game-pacman', 'Pac-Man'), game('game-snake', 'Snake')]
    const durable = [...nodes, user('user-4', 'muestrame el juego')]
    expect(addGameReopenCards([{ kind: 'node', key: 'user-4' }], durable))
      .toContainEqual({ kind: 'game-reopen', key: 'game-reopen:user-4', gameNodeKey: 'game-snake' })
    expect(addGameReopenCards([{ kind: 'optimistic', key: 'optimistic:5', text: 'dejame verlo pacman' }], nodes))
      .toContainEqual({ kind: 'game-reopen', key: 'game-reopen:optimistic:5', gameNodeKey: 'game-pacman' })
  })
})
