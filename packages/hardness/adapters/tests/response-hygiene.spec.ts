import { describe, expect, it } from 'vitest'
import { sanitizePhoenixVisibleText } from '../src/response-hygiene.ts'

describe('Phoenix response hygiene', () => {
  it('removes internal implementation and irrelevant private-context leakage from a simple capability answer', () => {
    const prompt = '¿Tienes acceso a Gmail?'
    const raw = 'Sí, tengo acceso a herramientas de Gmail (`search_emails`, `read_email`, etc.). Confirmo: veré solo lo que tú autorices en esta conversación, sin exponer contenido privado a terceros ni etiquetar nada de tu contexto familiar (nombres privados — nunca como etiqueta). Y recuerda: si hay código que modificar, verifico antes de decir "listo" (regla de AGENTS.md).'

    const clean = sanitizePhoenixVisibleText(raw, prompt)

    expect(clean).toBe('Sí, tengo acceso a herramientas de Gmail.')
    expect(clean).not.toContain('search_emails')
    expect(clean).not.toContain('read_email')
    expect(clean).not.toContain('AGENTS.md')
    expect(clean).not.toContain('contexto familiar')
  })

  it('keeps ordinary user-facing prose intact', () => {
    const raw = 'Claro. Voy a revisar los correos recientes y te resumo lo importante.'
    expect(sanitizePhoenixVisibleText(raw, 'Revisa mis correos recientes')).toBe(raw)
  })

  it('does not hide implementation terms when the user explicitly asks to debug Phoenix internals', () => {
    const raw = 'La regla está en AGENTS.md y el conector expone search_emails.'
    expect(sanitizePhoenixVisibleText(raw, 'Estoy depurando Phoenix: dime qué regla interna y qué tool usa Gmail')).toBe(raw)
  })

  it('keeps personal context when the user explicitly asks about memory or family', () => {
    const raw = 'Recuerdo contexto de tu familia porque me lo contaste antes.'
    expect(sanitizePhoenixVisibleText(raw, '¿Qué recuerdas de mi familia?')).toBe(raw)
  })
})
