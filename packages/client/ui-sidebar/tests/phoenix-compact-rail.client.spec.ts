import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')
const component = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.tsx', import.meta.url)), 'utf8')

describe('Phoenix approved light icon rail', () => {
  it('retains the real actions and gives each icon an accessible, balanced hit target', () => {
    for (const feature of ['nav.home', 'nav.discover', 'nav.connectors', 'nav.team', 'nav.library']) {
      expect(component).toContain("t('" + feature + "')")
    }
    expect(component).toContain('width={wide ? 19 : 21}')
    expect(component).toContain('size={wide ? 19 : 21}')
    expect(component).toContain('onClick={openLibrary}')
    expect(component).toContain('toggleSidebar()')
    expect(css).toContain('.collapsed .navLink svg { width: 21px; height: 21px; }')
    expect(css).toContain('width: 52px;')
    expect(css).toContain('height: 51px;')
  })

  it('keeps settings/workspaces/quota slots and responsive short-viewport controls', () => {
    expect(component).toContain("renderSlot('sidebar.workspaces'")
    expect(component).toContain("renderSlot('sidebar.footer.action'")
    expect(component).toContain("renderSlot('sidebar.settings'")
    expect(css).toContain('.root.collapsed {')
    expect(css).toContain('@media (max-height: 750px)')
    expect(css).toContain('.collapsed .navLink { height: 43px; min-height: 43px; }')
  })
})
