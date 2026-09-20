import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const PRESET_ROOT = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

it('keeps image_generation exposed in Code Mode just like the standard preset', async () => {
  const standard = await readFile(`${PRESET_ROOT}standard/agent.cordis.yml`, 'utf8')
  const code = await readFile(`${PRESET_ROOT}code/agent.cordis.yml`, 'utf8')
  const imageGenerationRow = [
    '- id: tool-image-generation',
    "  name: '@phoenix-ai/dsh-llm-pi-ai'",
    '  config:',
    '    imageOnly: true',
  ].join('\n')

  expect(standard).toContain(imageGenerationRow)
  expect(code).toContain(imageGenerationRow)
  expect(standard).toContain('imágenes reales en raster y de alta calidad')
  expect(standard).toContain('backend=auto')
  expect(standard).toContain('Higgsfield')
  expect(code).toContain('high-quality raster asset')
  expect(code).toContain('instead of faking the image')
  expect(code).toContain('backend=auto')
  expect(code).toContain('Higgsfield')
})
