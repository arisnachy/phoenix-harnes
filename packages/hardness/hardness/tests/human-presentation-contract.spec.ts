import { describe, expect, it } from 'vitest'
import { renderCognitiveWorkflowGuide } from '../src/cognitive-workflow.ts'

describe('HARDNESS human presentation contract', () => {
  it('keeps cognitive orchestration private and preserves quality in fast mode', () => {
    const guide = renderCognitiveWorkflowGuide('en')

    expect(guide).toContain('Treat workflow labels, execution modes, quality gates, retries, and tool orchestration as private execution scaffolding')
    expect(guide).toContain('Do not expose them as user-facing headings, status narration, or implementation jargon')
    expect(guide).toContain('Fast mode changes internal cost and latency only')
    expect(guide).toContain('never the requested scope, deliverables, verification, or quality bar')
    expect(guide).toContain('Keep user-facing language natural, warm, direct, and focused on useful progress or results')
  })

  it('carries the same boundary in Spanish', () => {
    const guide = renderCognitiveWorkflowGuide('es')

    expect(guide).toContain('Trata las etiquetas de flujo, modos de ejecución, quality gates, reintentos y orquestación de herramientas como andamiaje privado de ejecución')
    expect(guide).toContain('No los expongas como encabezados, narración de estado o jerga de implementación')
    expect(guide).toContain('El modo fast cambia solo el costo y la latencia internos')
    expect(guide).toContain('nunca el alcance solicitado, los entregables, la verificación ni el nivel de calidad')
    expect(guide).toContain('Mantén el lenguaje hacia el usuario natural, cálido, directo y centrado en progreso útil o resultados')
  })
})
