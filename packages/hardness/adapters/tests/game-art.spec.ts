import { describe, expect, it } from 'vitest'
import { validateGameArt } from '../src/game-art.ts'

const atlas = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABKklEQVR4nO2YoRIBYRSFl+wZPIAgCuIG0RhRMJIgCqIgCqIgGUE0RhQ2CqLgATyDvjL//Wf2pjN2vy/iM2fO7MzOuUkCUGlqsS+agyz//ex1TqO//6Vl+E+H3zH8u8NPDT8z/HrRPywrFKAOoIYC1AHUUIA6gJqv92JjnwfvzhjvSS14p/6jX/kngALUAQAAlET3dd/Y0xfHHh8Z/tHhTw1/5/Dnhr/hHhBCAeoAaihAHUANBagDqOEeUFQoKxSgDgAAoCS6r5fGnl459vja8BcOf2v4M4d/MPwx94AQClAHUEMB6gBqKEAdQA33gKJCWaEAdQAAACXRfX0y9vTQscevht9z+DfD7zr8h+G3uQeEUIA6gBoKUAdQQwHqAGq4BxQVygoFqAOAmA/CLIBZ7a+fzAAAAABJRU5ErkJggg=='
const frames = {
  idle: [0, 1], run: [2, 3, 4, 5], jump: [6], fall: [7],
  shoot: [8, 9], hurt: [10], death: [11, 12, 13],
}
const production = {
  gameType: 'run-and-gun',
  art: {
    mode: 'production',
    designReference: 'character-concept-approved.png',
    hero: { imageId: 'hero-art', frameWidth: 16, frameHeight: 16, animations: frames },
    backgrounds: [{ imageId: 'jungle-background' }],
  },
} as const

const html = '<html><body><canvas id="game"></canvas>'
  + '<img hidden id="hero-art" src="' + atlas + '">'
  + '<img hidden id="jungle-background" src="' + atlas + '">'
  + '<script>const hero=document.getElementById("hero-art");'
  + 'const bg=document.getElementById("jungle-background");'
  + 'const ctx=document.querySelector("canvas").getContext("2d");ctx.drawImage(hero,0,0);ctx.drawImage(bg,0,0);</script>'
  + '</body></html>'

const roster = [
  { family: 'backgrounds', id: 'hills', imageId: 'hills-art' },
  { family: 'backgrounds', id: 'front', imageId: 'front-art' },
  { family: 'enemies', id: 'scout', imageId: 'scout-art',
    frameWidth: 16, frameHeight: 16, animations: { move: [0], attack: [1], hurt: [2], death: [3] } },
  { family: 'bosses', id: 'warden', imageId: 'warden-art',
    frameWidth: 16, frameHeight: 16,
    animations: { idle: [0], attack: [1], hurt: [2], death: [3] },
    phaseAnimations: { approach: [0], barrage: [1] } },
  { family: 'weapons', id: 'rifle', imageId: 'rifle-art' },
  { family: 'projectiles', id: 'bullet', imageId: 'bullet-art' },
  { family: 'powers', id: 'shield', imageId: 'shield-art' },
  { family: 'props', id: 'supply-crate', imageId: 'crate-art' },
  { family: 'effects', id: 'explosion', imageId: 'explosion-art' },
  { family: 'effects', id: 'dust', imageId: 'dust-art' },
]
const full = {
  ...production,
  enemies: [{ id: 'scout', states: ['move', 'attack', 'hurt', 'death'] }],
  bosses: [{ id: 'warden', phases: ['approach', 'barrage'] }],
  level: { layers: [{ id: 'sky', scrollFactor: 0 }, { id: 'hills', scrollFactor: .5 }, { id: 'front', scrollFactor: .9 }] },
  art: {
    ...production.art,
    backgrounds: [{ id: 'sky', imageId: 'jungle-background' }, ...roster.filter(item => item.family === 'backgrounds')],
    ...Object.fromEntries(['enemies', 'bosses', 'weapons', 'projectiles', 'powers', 'props', 'effects']
      .map(family => [family, roster.filter(item => item.family === family)])),
  },
}
const worldHtml = html.replace('</body>', roster.map((entry, i) =>
  '<img hidden id="' + entry.imageId + '" src="' + atlas + '">'
  + '<script>const art' + i + '=document.getElementById("' + entry.imageId
  + '");ctx.drawImage(art' + i + ',0,0);</script>').join('') + '</body>')

describe('Phoenix Game Studio visual asset binding', () => {
  it('requires explicit honest art intent for representational action games', () => {
    expect(() => validateGameArt(html, { genre: 'run-and-gun' })).toThrow('art.mode')
    expect(validateGameArt(html, { genre: 'run-and-gun', art: { mode: 'prototype' } })).toBe('prototype')
    expect(validateGameArt(html, { genre: 'puzzle' })).toBe('not-required')
  })

  it('accepts production packaging only when the real designed hero atlas and background are embedded and used', () => {
    expect(validateGameArt(worldHtml, full)).toBe('production-structure')
  })

  it('blocks a production run-and-gun when any part of the cast or environment is absent', () => {
    for (const family of ['enemies', 'bosses', 'weapons', 'projectiles', 'powers', 'props', 'effects', 'backgrounds']) {
      const art = { ...full.art, [family]: [] }
      expect(() => validateGameArt(worldHtml, { ...full, art })).toThrow('art.' + family)
    }
    expect(() => validateGameArt(worldHtml, { ...full, art: { ...full.art, bosses: [
      { ...roster.find(item => item.family === 'bosses'), phaseAnimations: { approach: [0] } ] } }))
      .toThrow('fase')
    expect(() => validateGameArt(worldHtml.replace('ctx.drawImage(art4,0,0);', ''), full))
      .toThrow('drawImage')
  })

  it('rejects concept art that is present but not rendered in the game', () => {
    expect(() => validateGameArt(html.replace('ctx.drawImage(hero,0,0);', ''), production))
      .toThrow('drawImage')
    expect(() => validateGameArt(html.replace('hero-art', 'lost-hero'), production)).toThrow('falta un <img>')
    expect(() => validateGameArt(html.replace('const hero=document.getElementById("hero-art");', ''), production))
      .toThrow('drawImage')
    expect(() => validateGameArt(html.replaceAll('hero-art', 'different-hero'), production))
      .toThrow('falta un <img>')
  })

  it('rejects missing scenery, inadequate running frames and unsupported bitmap grids', () => {
    expect(() => validateGameArt(html, {
      ...production, art: { ...production.art, backgrounds: [] },
    })).toThrow('escenario')
    expect(() => validateGameArt(html, {
      ...production, art: { ...production.art, hero: { ...production.art.hero, animations: { ...frames, run: [1, 1, 1, 1] } } },
    })).toThrow('mismo frame')
    expect(() => validateGameArt(html, {
      ...production, art: { ...production.art, hero: { ...production.art.hero, frameWidth: 14 } },
    })).toThrow('dividir exactamente')
  })

  it('rejects invalid or remote art in place of a playable local PNG atlas', () => {
    expect(() => validateGameArt(html.replaceAll(atlas, 'https://example.com/art.png'), production))
      .toThrow('PNG incrustado')
    expect(() => validateGameArt(html.replaceAll(atlas, 'data:image/png;base64,AAAA'), production))
      .toThrow('PNG completo')
  })
})
