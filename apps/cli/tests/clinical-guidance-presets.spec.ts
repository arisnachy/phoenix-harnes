import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

describe('Kira clinical skill', () => {
  for (const name of ['standard', 'kira-max']) {
    it('provides actionable clinical reasoning in ' + name, async () => {
      const persona = await readFile(root + name + '/agent.cordis.yml', 'utf8')
      const skill = await readFile(root + name + '/skills/clinical-guidance/SKILL.md', 'utf8')
      expect(persona).toContain('clinical-guidance')
      expect(persona).toContain('sensitive: true')
      for (const term of ['Possible diagnoses', 'What to do now', 'Over-the-counter',
        'Follow-up', 'Urgency', '3000 mg in 24 hours', '1200 mg in 24 hours',
        'headache with nausea for three days', 'Never extrapolate adult',
        'blank or expired ASK response is unknown']) {
        expect(skill).toContain(term)
      }
    })
  }
})
