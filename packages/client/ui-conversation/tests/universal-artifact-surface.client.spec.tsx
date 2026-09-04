// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UniversalArtifactSurface } from '../src/client/chat/UniversalArtifactSurface.tsx'
import { clampArtifactHeight, normalizeHardnessArtifact } from '../src/client/conversation-nodes/hardness-artifact.ts'

describe('universal artifact surface', () => {
  afterEach(() => { cleanup() })

  it('normalizes JSON, Python, HTML, and image artifacts into one envelope', () => {
    expect(normalizeHardnessArtifact({ id: 'json', title: 'Data', mime: 'application/json', data: '{"ok":true}' })).toMatchObject({ kind: 'json', executable: false })
    expect(normalizeHardnessArtifact({ id: 'py', title: 'Model', mime: 'text/x-python', data: 'print(1)' })).toMatchObject({ kind: 'code', language: 'python', executable: true })
    expect(normalizeHardnessArtifact({ id: 'js', title: 'Script', mime: 'text/plain', language: 'javascript', data: 'console.log(1)' })).toMatchObject({ kind: 'text', language: 'javascript', executable: false })
    expect(normalizeHardnessArtifact({ id: 'html', title: 'App', mime: 'text/html', data: '<button>Run</button>' })).toMatchObject({ kind: 'html', executable: true })
    expect(normalizeHardnessArtifact({ id: 'image', title: 'Chart', mime: 'image/png', data: 'data:image/png;base64,AA==' })).toMatchObject({ kind: 'image', executable: false })
  })

  it('clamps adaptive height to the configured range', () => {
    expect(clampArtifactHeight(80, { minHeight: 160, maxHeight: 640 })).toBe(160)
    expect(clampArtifactHeight(800, { minHeight: 160, maxHeight: 640 })).toBe(640)
    expect(clampArtifactHeight(320, { minHeight: 160, maxHeight: 640 })).toBe(320)
  })

  it('renders code with one adaptive surface and exposes execution controls', () => {
    render(<UniversalArtifactSurface artifact={normalizeHardnessArtifact({
      id: 'code', title: 'Python check', mime: 'text/x-python', data: 'print("ready")',
    })} onRun={() => {}} onStop={() => {}} />)
    const surface = screen.getByText('Python check').closest('section')
    if (surface === null) throw new Error('artifact surface was not rendered')
    expect(screen.getByText('Python check')).toBeTruthy()
    expect(screen.getByText('print("ready")')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(surface.style.height).toBe('')
    expect(surface.style.maxHeight).toBe('')
  })

  it('downloads resolved image attachment bytes instead of serializing metadata', async () => {
    const attachment = {
      attachmentId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mediaType: 'image/png',
      bytes: 4,
      width: 1,
      height: 1,
      name: 'generated.png',
    }
    const loadImage = vi.fn().mockResolvedValue('blob:resolved-image')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<UniversalArtifactSurface
      artifact={normalizeHardnessArtifact({
        id: 'image', title: 'HARDNESS result', mime: 'image/png',
        data: { provider: 'codex', model: 'codex-built-in-image-gen', attachment },
      })}
      loadImage={loadImage}
      onStop={() => {}}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    await waitFor(() => { expect(loadImage).toHaveBeenCalledWith(attachment) })
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })

  it('runs executable HTML inside an isolated iframe and does not expose parent access', () => {
    render(<UniversalArtifactSurface artifact={normalizeHardnessArtifact({
      id: 'app', title: 'Mini app', mime: 'text/html', data: '<button>Ready</button>',
    })} onRun={() => {}} onStop={() => {}} />)
    const frame = screen.getByTitle('Mini app')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain('connect-src \'none\'')
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeTruthy()
  })
})
