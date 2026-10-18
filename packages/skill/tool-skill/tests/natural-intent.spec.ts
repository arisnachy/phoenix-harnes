import { describe, expect, it } from 'vitest'
import { naturalCreationSkill } from '../src/natural-intent.js'

describe('natural requests for playable game creation', () => {
  it.each([
    'haz un juego tipo Double Dragon de un nivel',
    'hazme un juego de carreras',
    'crea un videojuego de estrategia',
    'quiero un juego tipo Metal Slug',
    'un juego tipo Contra',
    '¿Puedes hacerme un juego de exploración?',
    '¿Me puedes crear un juego de lucha?',
    'quiero que hagas un juego de dinosaurios',
    'me gustaría que hicieras un juego de ciencia ficción',
    'haz un juego de carreras ' + 'con muchos detalles '.repeat(300),
    'make a game about space',
    'build a video game like Tetris',
  ])('selects Game Studio for %s', request => {
    expect(naturalCreationSkill(request)).toBe('game-development')
  })

  it.each([
    'como se hace un videojuego',
    'que es un juego de rol',
    'no quiero que hagas un juego',
    'do not create a game',
    'revisa el juego que hice',
    'escribe un libro sobre videojuegos',
    '¿Puedes explicarme cómo hacer un juego?',
  ])('leaves unrelated requests alone: %s', request => {
    expect(naturalCreationSkill(request)).toBeUndefined()
  })
})
