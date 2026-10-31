import { describe, expect, it } from 'vitest'
import { isSelfImageRequest } from '../src/client/portrait-reference.ts'

describe('private user portrait reference intent', () => {
  it('recognizes specific image requests depicting the user', () => {
    expect(isSelfImageRequest('Crea una foto mía en la playa')).toBe(true)
    expect(isSelfImageRequest('Dame una imagen mía en Nueva York')).toBe(true)
    expect(isSelfImageRequest('Dame una imagen de mí en una nave futurista tipo Kira')).toBe(true)
    expect(isSelfImageRequest('Muéstrame una foto mía en Marte')).toBe(true)
    expect(isSelfImageRequest('Quiero una imagen que salga yo en París')).toBe(true)
    expect(isSelfImageRequest('Ponme en Marte como astronauta')).toBe(true)
    expect(isSelfImageRequest('Genera un retrato de mi rostro')).toBe(true)
    expect(isSelfImageRequest('Create a portrait of me in London')).toBe(true)
  })
  it('does not transmit a private photo for an ordinary or third-party request', () => {
    expect(isSelfImageRequest('Hola, ¿cómo estás?')).toBe(false)
    expect(isSelfImageRequest('Crea una imagen de mi casa')).toBe(false)
    expect(isSelfImageRequest('Haz una foto del equipo Kira')).toBe(false)
    expect(isSelfImageRequest('Explica cómo transformar mi foto')).toBe(false)
    expect(isSelfImageRequest('Crea una foto de mi perro')).toBe(false)
    expect(isSelfImageRequest('Dame una imagen de Kira')).toBe(false)
    expect(isSelfImageRequest('Dame una imagen de mi casa')).toBe(false)
    expect(isSelfImageRequest('Dame una imagen de mi casa')).toBe(false)
    expect(isSelfImageRequest('Esa foto mía no me gusta')).toBe(false)
    expect(isSelfImageRequest('Explícame cómo generar una foto mía')).toBe(false)
  })
})
