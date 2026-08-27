import { describe, expect, it } from 'vitest'
import { renderGenerativeUi, validateUiSchema } from '../src/client/generative-ui.ts'

describe('HARDNESS generative UI runtime', () => {
  it('renders an extensible declarative BMI schema without executable fields', () => {
    const schema = {
      version: 1,
      root: { type: 'stack', children: [
        { type: 'input', id: 'weight', label: 'Weight (kg)' },
        { type: 'input', id: 'height', label: 'Height (cm)' },
        { type: 'result', id: 'bmi', label: 'BMI' },
      ] },
    } as const
    expect(validateUiSchema(schema)).toBe(true)
    expect(renderGenerativeUi(schema)).toEqual({ kind: 'generative-ui', version: 1, root: schema.root })
    expect(JSON.stringify(schema)).not.toMatch(/execute|javascript|onClick/)
  })

  it('rejects executable or malformed schemas', () => {
    expect(validateUiSchema({ version: 1, root: { type: 'button', execute: 'rm -rf' } })).toBe(false)
    expect(validateUiSchema({ version: 2, root: { type: 'stack', children: [] } })).toBe(false)
  })
})
