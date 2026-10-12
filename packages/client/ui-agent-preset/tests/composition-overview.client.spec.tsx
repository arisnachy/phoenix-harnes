import { describe, expect, it } from 'vitest'
import { compositionGroups } from '../src/client/CompositionOverview.tsx'
import { en, es, zh } from '../src/client/locales.ts'

describe('localized preset composition overview', () => {
  const source = [
    '# Technical original instructions in English',
    '# ── identity ─────────────────────',
    '- id: persona',
    "  name: '@phoenix-ai/dsh-persona'",
    '  config:',
    '    text: You are an agent.',
    '# ── shell ─────────────────────',
    '- id: tool-pwsh',
    "  name: '@phoenix-ai/dsh-tool-pwsh'",
    "  disabled: !!js process.platform !== 'win32'",
    '  config:',
    '    enableComputerUse: true',
    '# ── delegation and workflows ─────────────────────',
    '- id: delegation',
    '  name: cordis:group',
    '  group: true',
    '  config:',
    '    - id: tool-agent-team',
    "      name: '@phoenix-ai/dsh-tool-agent-team'",
  ].join('\n')

  it('enumerates root and nested plugin IDs without evaluating executable expressions', () => {
    const groups = compositionGroups(source)
    expect(groups.map(group => group.key)).toEqual(['viewerIdentity', 'viewerShell', 'viewerTeam'])
    expect(groups.flatMap(group => group.items.map(item => item.id)))
      .toEqual(['persona', 'tool-pwsh', 'delegation', 'tool-agent-team'])
    expect(groups[1]?.items[0]?.disabled).toBe(true)
    expect(source).toContain("!!js process.platform !== 'win32'")
  })

  it('keeps all locale labels available to the active client language', () => {
    expect(es.viewerShell).toBe('Consola y computadora')
    expect(en.viewerShell).toBe('Shell and computer')
    expect(zh.viewerShell).toBe('终端和计算机')
    expect(es.presetKiraMaxName).toBe('Kira Máximo')
  })

  it('handles malformed, empty and unrecognized read-only content without throwing', () => {
    expect(compositionGroups('')).toEqual([])
    expect(compositionGroups('# ── other ──\n- id: test\n  name: unknown'))
      .toMatchObject([{ key: 'viewerOther', items: [{ id: 'test', plugin: 'unknown' }] }])
  })
})
