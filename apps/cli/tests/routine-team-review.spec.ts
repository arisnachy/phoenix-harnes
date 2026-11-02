import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

it.each(['standard', 'code', 'cordis'])('%s keeps routine tasks direct and completion explicit', async (preset) => {
  const text = await readFile(new URL(`../config/agent-presets/${preset}/agent.cordis.yml`, import.meta.url), 'utf8')
  expect(text).not.toMatch(/Every actionable .* must contain real Team work|Toda tarea operativa .* debe involucrar trabajo real/u)
  expect(text).toContain('Routine low-risk requests are completed directly by Kira')
  expect(text).toContain('Assignments, plans and internal task updates are not delivery')
  expect(text).toContain('Formal HARDNESS missions retain their independent judge gate')
  expect(text).toContain('report what is done, what remains and the concrete blocker')
})
