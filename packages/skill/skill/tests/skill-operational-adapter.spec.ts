import { describe, expect, it } from 'vitest'
import {
  buildOperationalProfile,
  renderOperationalPrelude,
  type OperationalSkillInput,
} from '@phoenix-ai/dsh-skill'

const skill = (patch: Partial<OperationalSkillInput> = {}): OperationalSkillInput => ({
  name: 'demo-skill',
  description: 'Use the demo CLI to inspect a project.',
  whenToUse: 'Use for project inspection.',
  content: 'Run the demo CLI and summarize the result.',
  ...patch,
})

describe('skill operational adapter', () => {
  it('classifies unavailable documented tools as conditional', () => {
    const profile = buildOperationalProfile(skill(), new Set<string>())
    expect(profile.executionMode).toBe('conditional')
    expect(profile.toolMappings.some(mapping => mapping.available)).toBe(false)
    expect(profile.externalRequirements).toContain('demo CLI')
  })

  it('does not invent tools that are absent from runtime capabilities', () => {
    const profile = buildOperationalProfile(skill({ description: 'Call web_fetch for a report.' }), new Set(['skill']))
    expect(profile.toolMappings).not.toContainEqual(expect.objectContaining({ available: true }))
  })

  it('requires disambiguation before querying an ambiguous weather location', () => {
    const profile = buildOperationalProfile(skill({
      name: 'openclaw-weather',
      description: 'Current weather and forecasts with web_fetch.',
      content: 'Use web_fetch for the selected location.',
    }), new Set(['web_fetch']))
    expect(profile.requiredInputs).toContain('location')
    expect(profile.disambiguation).toContainEqual(expect.objectContaining({ input: 'location' }))
    expect(renderOperationalPrelude(profile)).toContain('No consultes la red')
  })

  it('keeps generated operational prose free of accidental Chinese markers', () => {
    const profile = buildOperationalProfile(skill(), new Set(['skill']))
    const prelude = renderOperationalPrelude(profile)
    expect(prelude).not.toContain('用途')
    expect(prelude).not.toMatch(/[\u4e00-\u9fff]/)
  })
})
