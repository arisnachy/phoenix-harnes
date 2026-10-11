import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')
const component = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.tsx', import.meta.url)), 'utf8')
const finalRail = css.slice(css.indexOf('/* Compact Phoenix icon rail'))

describe('Phoenix compact golden rail', () => {
  it('keeps every real navigation action and accessible toggle', () => {
    for (const feature of ['nav.home', 'nav.discover', 'nav.connectors', 'nav.team', 'nav.library']) {
      expect(component).toContain("t('" + feature + "')")
    }
    expect(component).toContain('width={wide ? 19 : 18}')
    expect(component).toContain('height={wide ? 19 : 18}')
    expect(component).toContain('size={wide ? 19 : 18}')
    expect(component).toContain('<IconNewChatOutline16 size={wide ? 14 : 18} />')
    expect(component).toContain('onClick={openLibrary}')
    expect(component).toContain('toggleSidebar()')
    expect(component).toContain("renderSlot('sidebar.workspaces'")
    expect(component).toContain("renderSlot('sidebar.footer.action'")
    expect(component).toContain("renderSlot('sidebar.settings'")
  })

  it('uses one authoritative compact scale with centered controls', () => {
    expect(finalRail).toContain('.root.collapsed {')
    expect(finalRail).toContain('padding: 8px 17px 10px;')
    expect(finalRail).toContain('align-self: center;')
    expect(finalRail).toContain('width: 46px;')
    expect(finalRail).toContain('height: 46px;')
    expect(finalRail).toContain('.collapsed .navLink svg {\n  width: 18px;\n  height: 18px;')
    expect(finalRail).not.toContain('width: 52px;')
    expect(finalRail).not.toContain('width: 54px;')
    expect(finalRail).not.toContain('height: 54px;')
    expect(finalRail).not.toContain('width: 21px;')
    expect(finalRail).not.toContain('width: 24px;')
  })

  it('keeps the official feathered emblem gold rather than a flattened orange silhouette', () => {
    expect(component).toContain("renderSlot('sidebar.brand.mark', { size: 34 }")
    expect(finalRail).toContain('width: 34px;')
    expect(finalRail).toContain('height: 34px;')
    expect(finalRail).toContain('filter: sepia(1) saturate(1.45) hue-rotate(8deg) brightness(1.12)')
    expect(finalRail).not.toContain('filter: brightness(0)')
    expect(finalRail).toContain('.root:not(.collapsed) .brandMark img')
  })

  it('preserves legibility in low-height Chrome windows and reduced motion', () => {
    expect(finalRail).toContain('@media (max-height: 750px)')
    expect(finalRail).toContain('.collapsed .navLink { height: 42px; min-height: 42px; }')
    expect(finalRail).toContain('.collapsed .newSession { height: 43px; margin-bottom: 6px; }')
    expect(finalRail).toContain('@media (prefers-reduced-motion: reduce)')
    expect(finalRail).toContain('.collapsed .settingsArea :global(button svg)')
  })
})
