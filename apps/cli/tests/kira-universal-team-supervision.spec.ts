import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PRESET_ROOT = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

describe('universal Kira Team supervision', () => {
  it('keeps the selected model as Lead while exposing bounded Team execution in every full preset', async () => {
    const presets = await Promise.all(
      ['standard', 'code', 'cordis'].map(async name => ({
        name,
        content: await readFile(`${PRESET_ROOT}${name}/agent.cordis.yml`, 'utf8'),
      })),
    )

    for (const { name, content } of presets) {
      expect(content, name).toContain('@phoenix-ai/dsh-tool-agent-team')
      expect(content, name).toContain('defaultModelProfile: luna-max')
      expect(content, name).toContain('provider: openai-codex')
      expect(content, name).toContain('model: gpt-6-luna')
      expect(content, name).toContain('reasoningEffort: max')
      expect(content, name).toMatch(/selected model remains the Team Lead|modelo que el usuario seleccionó conserva el mando como Lead/u)
      expect(content, name).toMatch(/elapsedMs/u)
      expect(content, name).toMatch(/not theater|no teatro/u)
      expect(content, name).toMatch(/never cross providers silently|nunca cruces proveedores silenciosamente/u)
    }
  })

  it('keeps real Team chat, stable KIRA identities, and blocker escalation explicit', async () => {
    const contents = await Promise.all(
      ['standard', 'code', 'cordis'].map(name =>
        readFile(`${PRESET_ROOT}${name}/agent.cordis.yml`, 'utf8')),
    )

    for (const content of contents) {
      expect(content).toContain('send_message')
      expect(content).toContain('followup_task')
      expect(content).toContain('team_react')
      expect(content).toMatch(/stable KIRA personas|identidades estables del equipo Kira/u)
      expect(content).toMatch(/blockers return to the selected Lead|bloqueo vuelve al modelo seleccionado/u)
    }
  })
})
