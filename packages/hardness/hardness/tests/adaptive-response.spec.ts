import { describe, expect, it } from 'vitest'
import { selectAdaptiveResponseMode } from '../src/index.ts'

describe('HARDNESS adaptive response mode', () => {
  it('keeps ordinary factual and one-shot questions as text', () => {
    expect(selectAdaptiveResponseMode('¿Qué es la presión arterial?').mode).toBe('text')
    expect(selectAdaptiveResponseMode('¿Cuánto es 600000 por 14%?').mode).toBe('text')
    expect(selectAdaptiveResponseMode('Who discovered penicillin?').mode).toBe('text')
  })

  it('automatically selects a simulation when variables should be manipulated', () => {
    const result = selectAdaptiveResponseMode(
      'Muéstrame cómo cambia la presión arterial cuando aumento la resistencia vascular y déjame mover los parámetros.',
    )

    expect(result.mode).toBe('interactive')
    expect(result.kind).toBe('simulation')
    expect(result.modality).toBe('generative-ui')
    expect(result.interactionGain).toBeGreaterThanOrEqual(0.72)
  })

  it('automatically selects mini apps, games, dashboards and interactive calculators', () => {
    expect(selectAdaptiveResponseMode('Créame una mini app para controlar medicamentos').kind).toBe('mini_app')
    expect(selectAdaptiveResponseMode('Juguemos ajedrez aquí').kind).toBe('game')
    expect(selectAdaptiveResponseMode('Hazme un dashboard interactivo con estos indicadores').kind).toBe('dashboard')
    expect(selectAdaptiveResponseMode('Haz una calculadora interactiva de amortización con sliders').kind).toBe('calculator')
  })

  it('uses a visual response when a visual explanation adds value but state is not required', () => {
    const result = selectAdaptiveResponseMode('Muéstrame visualmente cómo funciona el ciclo de Krebs')

    expect(result.mode).toBe('interactive')
    expect(result.kind).toBe('visualization')
    expect(result.modality).toBe('visual')
  })

  it('does not over-trigger on incidental visual words', () => {
    expect(selectAdaptiveResponseMode('Dime qué significa visualización de datos').mode).toBe('text')
    expect(selectAdaptiveResponseMode('Explícame qué es un dashboard').mode).toBe('text')
  })
})
