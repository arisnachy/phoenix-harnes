// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeHardnessArtifact } from '../src/client/artifact.ts'
import { HardnessArtifactBody } from '../src/client/chat/HardnessArtifactBody.tsx'

const html = '<!doctype html><html><head><style>.comic-page{width:1200px}</style></head><body>'
  + '<main class="edition"><section class="comic-page"><article class="panel">'
  + '<img src="data:image/png;base64,AA==" alt="arte original"></article></section></main></body></html>'

describe('native Comic Studio artifact preview', () => {
  afterEach(() => { cleanup() })
  it('displays the comic in an isolated static, responsive reader rather than Game Studio or browser navigation', () => {
    const artifact = normalizeHardnessArtifact({
      id: 'comic:1', title: 'Cómic #1', mime: 'application/vnd.phoenix.comic+html',
      data: html, executable: false,
    })
    expect(artifact.kind).toBe('html')
    expect(artifact.executable).toBe(false)
    const view = render(
      <HardnessArtifactBody mime={artifact.mime} data={html} expanded={false}
        title={artifact.title} executable={false} />,
    )
    const comic = view.container.querySelector('[data-phoenix-comic-studio="true"]')
    expect(comic).not.toBeNull()
    const frame = comic?.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(frame?.getAttribute('sandbox')).toBe('allow-same-origin')
    expect(frame?.getAttribute('srcdoc')).toContain('data-phoenix-comic-responsive')
    expect(frame?.getAttribute('srcdoc')).toContain("connect-src 'none'")
    expect(view.container.querySelector('[data-phoenix-game-studio]')).toBeNull()
    expect(frame?.getAttribute('src')).toBeNull()
  })
})
