import { describe, expect, it } from 'vitest'
import { isGameDevelopmentNeed, qualityRequirementsForNeed } from '../src/quality-contract.ts'

function need(kind: string, extra: Record<string, unknown> = {}) {
  return { kind, ...extra }
}

describe('qualityRequirementsForNeed', () => {
  it('requires executable verification and operational robustness for software work', () => {
    const requirements = qualityRequirementsForNeed(need('code', { description: 'build a web application' }))
    expect(requirements.join(' ')).toMatch(/test|verification/i)
    expect(requirements.join(' ')).toMatch(/error|failure|robust/i)
    expect(requirements.join(' ')).toMatch(/security|unsafe|permission/i)
    expect(requirements.join(' ')).toMatch(/error.*type|message field|diagnostic/i)
    expect(requirements.join(' ')).toMatch(/scale|performance|memory|superlinear/i)
    expect(requirements.join(' ')).toMatch(/acceptance criterion|aggregate suite/i)
  })

  it('requires visual, responsive, and accessibility evidence for UI work', () => {
    const requirements = qualityRequirementsForNeed(need('ui', { description: 'responsive hospital dashboard' }))
    expect(requirements.join(' ')).toMatch(/visual|render|screenshot/i)
    expect(requirements.join(' ')).toMatch(/responsive/i)
    expect(requirements.join(' ')).toMatch(/accessib/i)
  })

  it('requires source traceability and unsupported-claim checks for research work', () => {
    const requirements = qualityRequirementsForNeed(need('research', { description: 'evidence review' }))
    expect(requirements.join(' ')).toMatch(/source|citation|trace/i)
    expect(requirements.join(' ')).toMatch(/unsupported|claim|factual/i)
  })

  it('requires reproducibility and validation for data analysis', () => {
    const requirements = qualityRequirementsForNeed(need('analysis', { description: 'analyze a dataset' }))
    expect(requirements.join(' ')).toMatch(/reproduc/i)
    expect(requirements.join(' ')).toMatch(/valid|cross-check|sanity/i)
  })

  it('requires premium audiovisual, gameplay, and executed-build evidence for game work', () => {
    const requirements = qualityRequirementsForNeed(need('creative', {
      description: 'Crea un juego SNES de alta calidad con personajes, ambientes, animación y sonido',
    }))
    const text = requirements.join(' ')
    expect(text).toMatch(/current high-quality references|quality bar/i)
    expect(text).toMatch(/graphics|art direction/i)
    expect(text).toMatch(/characters|silhouettes|animation/i)
    expect(text).toMatch(/rectangle|box|capsule|primitive mesh/i)
    expect(text).toMatch(/player.*enemy.*NPC|representative enemy|interactive actors/i)
    expect(text).toMatch(/pixel density|animation-state|locomotion/i)
    expect(text).toMatch(/environments|atmosphere|storytelling/i)
    expect(text).toMatch(/scene density|terrain transitions|prop\/vegetation variety/i)
    expect(text).toMatch(/character bible|secondary actors|recolors/i)
    expect(text).toMatch(/intro|opening|title sequence|cutscene/i)
    expect(text).toMatch(/boot\/title\/menu\/intro|transition into actual gameplay/i)
    expect(text).toMatch(/sound|music|ambience/i)
    expect(text).toMatch(/gameplay feel|input response|camera/i)
    expect(text).toMatch(/frame-time|performance|memory/i)
    expect(text).toMatch(/executed game|ROM|play evidence/i)
    expect(text).toMatch(/baseline.*current runnable build|baseline-before|candidate/i)
    expect(text).toMatch(/image_generation|Aseprite|Tiled|Blender/i)
    expect(text).toMatch(/asset-first scouting|candidate packs/i)
    expect(text).toMatch(/asset-manifest\.json|asset-sourcing\.json/i)
    expect(text).toMatch(/playable world.*dominate|dashboard\/sidebar|repeated-tile/i)
    expect(text).toMatch(/DOM\/CSS\/SVG\/canvas/i)
    expect(text).toMatch(/SaaS|dashboard|glassmorphism|web-app chrome/i)
    expect(requirements.length).toBeGreaterThanOrEqual(15)
  })

  it('keeps a strong domain-neutral baseline for unknown capability kinds', () => {
    const requirements = qualityRequirementsForNeed(need('future-capability'))
    expect(requirements.length).toBeGreaterThanOrEqual(3)
    expect(requirements.join(' ')).toMatch(/complete/i)
    expect(requirements.join(' ')).toMatch(/evidence|verif/i)
  })
  it.each(['haz un gta tipo ps1', 'aventura PlayStation', 'un sonic de Sega', 'crea un juego de Game Boy', 'build a racing game', 'make a browser Snake', 'implement playable chess', 'create a polished 2048 puzzle', 'create a strategy game', 'make a rhythm game'])('recognizes game development: %s', (description) => {
    expect(isGameDevelopmentNeed({ description })).toBe(true)
  })

  it.each(['explain snake biology', 'teach chess strategy', 'write a report about PlayStation sales', 'build a snake_case formatter', 'create a chess history lesson', 'make a Sega revenue dashboard', 'snake', 'chess', 'create a snake poster'])('does not turn unrelated or educational requests into game development: %s', (description) => {
    expect(isGameDevelopmentNeed({ description })).toBe(false)
  })

  it.each(['Create polished browser Snake', 'build a geometric Pong arcade', 'make a premium Tetris puzzle', 'implement playable chess', 'create a minimalist 2048 game'])('keeps abstract game quality without demanding representational assets: %s', (description) => {
    const text = qualityRequirementsForNeed({ description }).join(' ')
    expect(text).toMatch(/polished geometry/i)
    expect(text).toMatch(/procedural audio/i)
    expect(text).toMatch(/compact designed arena/i)
    expect(text).toMatch(/technical.*visual.*play|technical evidence and audiovisual\/play/i)
    expect(text).not.toMatch(/asset-first scouting|character bible|locomotion in every|prop\/vegetation variety/)
  })

  it('retains requested representational asset work within an abstract game', () => {
    const text = qualityRequirementsForNeed({ description: 'Create Snake with original character sprites and background assets' }).join(' ')
    expect(text).toMatch(/asset-manifest|provenance/)
    expect(text).not.toMatch(/character bible|locomotion in every|prop\/vegetation variety/)
  })

  it('uses the described game rather than incidental output metadata for classification', () => {
    expect(isGameDevelopmentNeed({ kind: 'creative', description: 'Create a geometric Snake game', outputs: ['quality-report'] })).toBe(true)
    expect(qualityRequirementsForNeed({ kind: 'creative', description: 'Create a geometric Snake game', outputs: ['quality-report'] }).join(' ')).toMatch(/polished geometry/)
  })

  it.each(['Crea un juego RPG con historia y misiones', 'Build a history-themed strategy game', 'Fix the game crash described in this report', 'Create a game using an article about history'])('keeps game development when educational words describe its theme or evidence: %s', (description) => {
    expect(isGameDevelopmentNeed({ description })).toBe(true)
  })

  it('does not classify a chess statistics dashboard as playable game development', () => {
    expect(isGameDevelopmentNeed({ description: 'create a chess statistics dashboard' })).toBe(false)
  })

  it('retains illustrated cast and background production for a puzzle game', () => {
    const text = qualityRequirementsForNeed({ description: 'Make a puzzle game with animated animal characters and illustrated backgrounds' }).join(' ')
    expect(text).toMatch(/asset-first scouting|production asset work/i)
    expect(text).toMatch(/asset-manifest|asset-sourcing/)
  })

  it.each(['Create a history lesson about video games', 'Write an article about RPG games', 'Prepare an essay on PlayStation adventure games'])('recognizes an educational output rather than the game topic: %s', (description) => {
    expect(isGameDevelopmentNeed({ description })).toBe(false)
  })

})
