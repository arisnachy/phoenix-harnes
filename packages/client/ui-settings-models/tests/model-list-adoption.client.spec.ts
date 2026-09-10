import { describe, expect, it } from 'vitest'
import { adoptDiscoveredModel } from '../src/client/ModelListEditor.tsx'

describe('ModelListEditor discovery adoption', () => {
  it('materializes executable Codex efforts and ignores unsupported future ids', () => {
    expect(adoptDiscoveredModel({
      id: 'gpt-6-astra',
      name: 'GPT-6-Astra',
      reasoning: {
        efforts: [
          { id: 'low', name: 'Low' },
          { id: 'medium', name: 'Medium' },
          { id: 'high', name: 'High' },
          { id: 'xhigh', name: 'Extra High' },
          { id: 'max', name: 'Max' },
          { id: 'ultra', name: 'Ultra' },
        ],
        defaultEffort: 'low',
      },
    })).toEqual({
      id: 'gpt-6-astra',
      name: 'GPT-6-Astra',
      reasoningEfforts: {
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: 'max',
      },
    })
  })

  it('keeps non-reasoning discovery rows unchanged', () => {
    expect(adoptDiscoveredModel({ id: 'plain-model', name: 'Plain' })).toEqual({
      id: 'plain-model',
      name: 'Plain',
    })
  })
})
