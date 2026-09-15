import { describe, expect, it } from 'vitest'
import { sanitizePhoenixVisibleText } from '../src/response-hygiene.ts'

describe('Phoenix response hygiene explicit technical topics', () => {
  it('keeps MCP explanations visible when the user explicitly asks what MCP is', () => {
    const raw = 'MCP es un protocolo para conectar capacidades externas.'
    expect(sanitizePhoenixVisibleText(raw, '¿Qué es MCP?')).toBe(raw)
  })

  it('keeps router and subagent explanations visible when explicitly requested', () => {
    const router = 'El router selecciona una ruta de ejecución.'
    const subagent = 'Un subagente puede ejecutar una tarea especializada.'
    expect(sanitizePhoenixVisibleText(router, 'Explícame qué es un router')).toBe(router)
    expect(sanitizePhoenixVisibleText(subagent, '¿Qué es un subagente?')).toBe(subagent)
  })
})
