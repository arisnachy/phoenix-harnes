import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@phoenix-ai/cordis'
import SkillRegistry from '@phoenix-ai/dsh-skill'
import * as SkillFileSystem from '@phoenix-ai/dsh-skill-filesystem'
import { auditBundle, openClawAlias } from '../src/openclaw-skills.ts'

async function tempDir(name: string): Promise<string> {
  return await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), `dsh-${name}-`)))
}

describe('OpenClaw skill bridge contract', () => {
  it('namespaces every upstream skill without changing its kebab identity', () => {
    expect(openClawAlias('diagram-maker')).toBe('openclaw-diagram-maker')
    expect(openClawAlias('bad_name')).toBe('openclaw-bad-name')
  })

  it('records MIT/source and runtime signals without copying secret values', () => {
    const record = auditBundle('weather', '---\nname: weather\ndescription: Weather\n---\n\nUse wttr.in and curl.')
    expect(record).toMatchObject({
      sourceName: 'weather',
      license: 'MIT',
      modelInvocable: true,
      userInvocable: true,
      signals: ['network', 'external-runtime'],
    })
    expect(JSON.stringify(record)).not.toMatch(/secret|token|api[_ -]?key/i)
  })

  it('preserves manual-only invocation metadata from upstream frontmatter', () => {
    const record = auditBundle('manual', '---\nname: manual\ndescription: Manual\ndisable-model-invocation: true\nuser-invocable: true\n---\n\nManual body.')
    expect(record.modelInvocable).toBe(false)
    expect(record.userInvocable).toBe(true)
  })

  it('does not classify an explicitly offline no-key skill as credentialed', () => {
    const record = auditBundle('offline', '---\nname: offline\ndescription: Local speech-to-text (no API key).\n---\n\nRun the local CLI.')
    expect(record.signals).not.toContain('credentials')
    expect(record.signals).toContain('external-runtime')
  })

  it('loads a namespaced bundle and its nested resources through PHOENIX', async () => {
    const home = await tempDir('openclaw-native-load')
    const root = join(home, '.dsh', 'skills', 'openclaw-diagram-maker')
    await mkdir(join(root, 'references', 'nested'), { recursive: true })
    await writeFile(join(root, 'SKILL.md'), [
      '---',
      'name: openclaw-diagram-maker',
      'description: Create diagrams.',
      '---',
      '',
      'Use the referenced patterns.',
    ].join('\n'))
    await writeFile(join(root, 'references', 'nested', 'patterns.md'), 'Pattern reference.')

    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
    })

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['openclaw-diagram-maker'])
    await expect(ctx.skills.get('openclaw-diagram-maker')).resolves.toMatchObject({
      name: 'openclaw-diagram-maker',
      source: 'user-dsh',
      resourceBase: { kind: 'directory', path: root },
      content: 'Use the referenced patterns.',
    })
  })
})
