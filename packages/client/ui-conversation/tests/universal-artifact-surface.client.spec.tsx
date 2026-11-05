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

  it('recovers static BMI HTML into a working native calculator and updates the result', () => {
    const legacyHtml = '<h1>Calculadora de IMC</h1><form>'
      + '<label for="peso">Peso</label><input type="number" id="peso" value="70"><span>kg</span>'
      + '<label for="talla">Estatura</label><input type="number" id="talla" value="168"><span>cm</span>'
      + '<button type="button">Calcular IMC</button></form>'
    render(<UniversalArtifactSurface artifact={normalizeHardnessArtifact({
      id:'html-bmi',title:'Calculadora de IMC',mime:'text/html',data:legacyHtml,
    })} onStop={() => {}} />)
    expect(screen.getByText('Resultados calculados')).toBeTruthy()
    expect(screen.getByText(/24\\.8 kg\\/m²/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Peso/), { target: { value:'72' } })
    fireEvent.change(screen.getByLabelText(/Estatura/), { target: { value:'180' } })
    expect(screen.getByText(/22\\.2 kg\\/m²/)).toBeTruthy()
    expect(screen.queryByRole('button', { name:'Calcular IMC' })).toBeNull()
  })

  it('shows why an HTML calculator without any formula cannot calculate', () => {
    const html = '<h1>Calculadora de impuestos</h1><form>'
      + '<input type="number"><button type="button">Calcular</button></form>'
    render(<UniversalArtifactSurface artifact={normalizeHardnessArtifact({
      id:'html-inert',title:'Calculadora de impuestos',mime:'text/html',data:html,
    })} onStop={() => {}} />)
    expect(screen.getByRole('alert').textContent).toContain('sin fórmula ejecutable')
    const frame = screen.getByTitle('Calculadora de impuestos')
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')
  })

  it('instruments authored HTML calculation failures while keeping the iframe isolated', () => {
    const html = '<form><input type="number"><button onclick="missingFunction()">Calcular</button></form>'
    render(<UniversalArtifactSurface artifact={normalizeHardnessArtifact({
      id:'script-calculator',title:'Cálculo externo',mime:'text/html',data:html,
    })} onStop={() => {}} />)
    const iframe = screen.getByTitle('Cálculo externo')
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe.getAttribute('srcdoc')).toContain('data-phoenix-form-error')
    expect(iframe.getAttribute('srcdoc')).toContain('connect-src \'none\'')
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
})
