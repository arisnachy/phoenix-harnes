import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { normalizeHardnessArtifact } from '../src/client/artifact.ts'
import { HardnessArtifactBody } from '../src/client/chat/HardnessArtifactBody.tsx'

const html = '<!doctype html><html><head><style>.comic-page{width:1200px}</style></head><body>'
  + '<main class="edition"><section class="comic-page"><article class="panel">'
  + '<img src="data:image/png;base64,AA==" alt="arte original"></article></section></main></body></html>'

describe('native Comic Studio artifact preview', () => {
  it('selects HTML rendering for dedicated comic MIME without treating comics as games', () => {
    const artifact = normalizeHardnessArtifact({
      id: 'comic:1', title: 'Cómic #1', mime: 'application/vnd.phoenix.comic+html',
      data: html, executable: false,
    })
    expect(artifact.kind).toBe('html')
    expect(artifact.executable).toBe(false)
    const view = renderToStaticMarkup(
      <HardnessArtifactBody mime={artifact.mime} data={html} expanded={false}
        title={artifact.title} executable={false} />,
    )
    expect(view).toContain('data-phoenix-comic-studio="true"')
    expect(view).toContain('data-phoenix-comic-responsive')
    expect(view).toContain('sandbox="allow-same-origin"')
    expect(view).not.toContain('data-phoenix-game-studio')
    expect(view).not.toContain('src="http://127.0.0.1:3080"')
  })
})
