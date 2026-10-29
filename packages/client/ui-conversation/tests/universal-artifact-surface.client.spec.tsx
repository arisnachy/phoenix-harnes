// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UniversalArtifactSurface } from '../src/client/chat/UniversalArtifactSurface.tsx'
import { clampArtifactHeight, normalizeHardnessArtifact } from '../src/client/conversation-nodes/hardness-artifact.ts'

describe('universal artifact surface', () => {
  afterEach(() => { cleanup() })

  it('opens and closes the comic reader without enabling scripts and offers a download', () => {
    render(<UniversalArtifactSurface artifact={normalizeHardnessArtifact({
      id: 'comic-reader', title: 'Edición de prueba', mime: 'application/vnd.phoenix.comic+html',
      data: '<!doctype html><html><head></head><body><p>Página de prueba</p><input type="checkbox" disabled></body></html>', executable: false,
    })} onStop={() => {}} />)
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    const dialog = screen.getByRole('dialog', { name: 'Vista ampliada: Edición de prueba' })
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(dialog.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-same-origin')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTitle('Edición de prueba')).toBeTruthy()
  })

  it('normalizes JSON, Python, HTML, and image artifacts into one envelope', () => {
    expect(normalizeHardnessArtifact({ id: 'json', title: 'Data', mime: 'application/json', data: '{"ok":true}' })).toMatchObject({ kind: 'json', executable: false })
    expect(normalizeHardnessArtifact({ id: 'py', title: 'Model', mime: 'text/x-python', data: 'print(1)' })).toMatchObject({ kind: 'code', language: 'python', executable: true })
    expect(normalizeHardnessArtifact({ id: 'js', title: 'Script', mime: 'text/plain', language: 'javascript', data: 'console.log(1)' })).toMatchObject({ kind: 'text', language: 'javascript', executable: false })
    expect(normalizeHardnessArtifact({ id: 'html', title: 'App', mime: 'text/html', data: '<button>Run</button>' })).toMatchObject({ kind: 'html', executable: true })
    expect(normalizeHardnessArtifact({ id: 'canvas', title: 'Canvas', mime: 'application/vnd.phoenix.canvas+html', data: '<canvas></canvas>' })).toMatchObject({ kind: 'html', executable: true })
    expect(normalizeHardnessArtifact({ id: 'web', title: 'Page', mime: 'application/vnd.phoenix.web-preview+json', data: { url: 'https://example.test' } })).toMatchObject({ kind: 'html', executable: true })
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

  it('loads remote images in static HTML preview without sending a referrer', () => {
    const artifact = normalizeHardnessArtifact({
      id: 'document',
      title: 'Coffee document',
      mime: 'text/html',
      data: '<img src="https://images.example.test/coffee.jpg" alt="Coffee">',
      executable: false,
    })
    render(<UniversalArtifactSurface artifact={artifact} onStop={() => {}} />)
    const frame = screen.getByTitle('Coffee document')
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame.getAttribute('srcdoc')).toContain('img-src data: blob: https: http:')
  })

  it('runs executable HTML inside an isolated iframe and does not expose parent access', () => {
    render(<UniversalArtifactSurface artifact={normalizeHardnessArtifact({
      id: 'app', title: 'Mini app', mime: 'text/html', data: '<button>Ready</button>',
    })} onRun={() => {}} onStop={() => {}} />)
    const frame = screen.getByTitle('Mini app')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame.getAttribute('srcdoc')).toContain('connect-src \'none\'')
    expect(frame.getAttribute('srcdoc')).toContain('img-src data: blob:')
    expect(frame.getAttribute('srcdoc')).not.toContain('img-src data: blob: https: http:')
    // Inline HTML mini-apps size themselves via their own iframe height report.
    // A native Expand dialog is reserved for visual/3D artifacts.
    expect(screen.queryByRole('button', { name: 'Expand' })).toBeNull()
  })
  it('shows a real temporary browser URL and packaged artwork for a website', async () => {
    const previousCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const previousRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    const createUrl = vi.fn().mockReturnValue('blob:http://localhost/phoenix-website')
    const revokeUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl })
    try {
      render(<UniversalArtifactSurface artifact={normalizeHardnessArtifact({
        id: 'kira-site', title: 'Sitio de Kira', mime: 'application/vnd.phoenix.canvas+html',
        data: {
          entry: 'index.html',
          files: {
            'index.html': '<link rel="stylesheet" href="theme.css"><img src="hero.png" alt="Kira">',
            'theme.css': '.hero{color:orange}',
            'hero.png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+e6I6JwAAAABJRU5ErkJggg==',
          },
        },
        executable: false,
      })} onStop={() => {}} />)
      const frame = screen.getByTitle('Sitio de Kira')
      expect(frame.getAttribute('srcdoc')).toContain('data:image/png;base64,')
      expect(frame.getAttribute('srcdoc')).toContain('data-phoenix-bundled-css')
      expect(frame.getAttribute('srcdoc')).not.toContain('data-phoenix-missing-image')
      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: 'URL temporal de la página' }))
          .toHaveProperty('value', 'blob:http://localhost/phoenix-website')
      })
      const opener = screen.getByRole('link', { name: 'Abrir página en otra pestaña' })
      expect(opener.getAttribute('href')).toContain('blob:')
      expect(opener.getAttribute('target')).toBe('_blank')
      expect(opener.getAttribute('rel')).toContain('noopener')
      expect(screen.getByRole('link', { name: 'Guardar HTML' }).getAttribute('download'))
        .toMatch(/\.html$/u)
      expect(createUrl).toHaveBeenCalled()
    } finally {
      cleanup()
      expect(revokeUrl).toHaveBeenCalled()
      if (previousCreate === undefined) Reflect.deleteProperty(URL, 'createObjectURL')
      else Object.defineProperty(URL, 'createObjectURL', previousCreate)
      if (previousRevoke === undefined) Reflect.deleteProperty(URL, 'revokeObjectURL')
      else Object.defineProperty(URL, 'revokeObjectURL', previousRevoke)
    }
  })

  it('does not claim that an unresolved generated image filename loaded', () => {
    render(<UniversalArtifactSurface artifact={normalizeHardnessArtifact({
      id: 'unbundled-site', title: 'Unbundled site', mime: 'text/html',
      data: '<img src="exec-123.png" alt="missing">', executable: false,
    })} onStop={() => {}} />)
    expect(screen.getByTitle('Unbundled site').getAttribute('srcdoc'))
      .toContain('data-phoenix-missing-image="true"')
  })

  it('resolves generated-image attachments into self-contained HTML without model-supplied base64', async () => {
    const picture = {
      attachmentId: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      mediaType: 'image/png', bytes: 68, width: 1, height: 1, name: 'hero.png',
    }
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+e6I6JwAAAABJRU5ErkJggg=='
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,' + png)
    render(<UniversalArtifactSurface artifact={normalizeHardnessArtifact({
      id: 'attachment-page', title: 'Kira con imagen', mime: 'application/vnd.phoenix.canvas+html',
      data: { entry: 'index.html', files: {
        'index.html': '<h1>Kira</h1><img src="hero.png" alt="Portada">',
        'hero.png': { attachment: picture },
      } },
      executable: false,
    })} loadImage={loadImage} onStop={() => {}} />)
    await waitFor(() => {
      expect(screen.getByTitle('Kira con imagen').getAttribute('srcdoc'))
        .toContain('src="data:image/png;base64,')
    })
    expect(loadImage).toHaveBeenCalledWith(picture)
    expect(screen.getByTitle('Kira con imagen').getAttribute('srcdoc'))
      .not.toContain('data-phoenix-missing-image')
  })

})
