// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HardnessArtifactNodeView } from '../src/client/chat/HardnessArtifactNodeView.tsx'

function props(data: {
  readonly artifactId: string
  readonly mime: string
  readonly title: string
  readonly data: string | Readonly<Record<string, unknown>>
}) {
  return {
    node: {
      kind: 'hardness-artifact',
      key: 'artifact-key',
      id: data.artifactId,
      target: 'chat',
      anchorSeq: 1,
      location: { kind: 'unresolved' },
      visibility: 'visible',
      data: {
        ...data,
        callId: 'call-1',
        seq: 1,
        time: 1,
      },
    },
  } as ComponentProps<typeof HardnessArtifactNodeView>
}

describe('HARDNESS inline artifact renderer', () => {
  it('renders a compact card and expands in place', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'table-1',
      mime: 'application/json',
      title: 'Results',
      data: { columns: ['Name', 'Score'], rows: [['A', 10], ['B', 12]] },
    })} />)

    expect(screen.getByText(/Results/)).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    expect(document.querySelector('header')).toBeNull()
    const expand = screen.getByRole('button', { name: 'Expand' })
    expect(expand.getAttribute('aria-label')).toBe('Expand')
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(expand)
    expect(screen.getByRole('button', { name: 'Collapse' }).getAttribute('aria-expanded')).toBe('true')
  })


  it('renders the Phoenix rich visual contract instead of raw JSON', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'visual-1',
      mime: 'application/vnd.phoenix.visual+json',
      title: 'Service overview',
      data: {
        visualType: 'metrics',
        metrics: [
          { label: 'Availability', value: '99.98%', delta: 0.12 },
          { label: 'Latency', value: '182 ms', delta: -14 },
        ],
      },
    })} />)

    expect(document.querySelector('[data-phoenix-visual-kind="metrics"]')).toBeTruthy()
    expect(screen.getByText('Availability')).toBeTruthy()
    expect(screen.getByText('99.98%')).toBeTruthy()
    expect(screen.queryByText(/"visualType"/)).toBeNull()
  })

  it('upgrades legacy chart artifacts to the multi-series visual renderer', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'visual-chart-1',
      mime: 'application/vnd.hardness.chart+json',
      title: 'Clinical trend',
      data: {
        chartType: 'line',
        xKey: 'month',
        series: [
          { dataKey: 'screened', label: 'Screened' },
          { dataKey: 'linked', label: 'Linked' },
        ],
        data: [
          { month: 'Jan', screened: 42, linked: 31 },
          { month: 'Feb', screened: 58, linked: 45 },
          { month: 'Mar', screened: 63, linked: 54 },
        ],
      },
    })} />)

    expect(document.querySelector('[data-phoenix-visual-kind="chart"]')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'line chart' })).toBeTruthy()
    expect(screen.getByText('Screened')).toBeTruthy()
    expect(screen.getByText('Linked')).toBeTruthy()
  })

  it('renders JSON-encoded chart specs instead of dumping the JSON text', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'json-chart-1',
      mime: 'application/json',
      title: 'chart.json',
      data: JSON.stringify({
        chartType: 'bar',
        xKey: 'day',
        series: [{ dataKey: 'sales', label: 'Sales' }],
        data: [{ day: 'Mon', sales: 18 }, { day: 'Tue', sales: 22 }],
      }),
    })} />)

    expect(document.querySelector('[data-phoenix-visual-kind="chart"]')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'bar chart' })).toBeTruthy()
    expect(screen.queryByText(/"chartType"/)).toBeNull()
  })

  it('adapts common labels/values JSON into the Phoenix chart renderer', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'json-chart-2',
      mime: 'application/json',
      title: 'weekly-sales.json',
      data: JSON.stringify({
        labels: ['Lun', 'Mar', 'Mié'],
        values: [18, 22, 15],
        seriesName: 'Ventas',
      }),
    })} />)

    expect(document.querySelector('[data-phoenix-visual-kind="chart"]')).toBeTruthy()
    expect(screen.getByText('Ventas')).toBeTruthy()
    expect(screen.queryByText(/"labels"/)).toBeNull()
  })

  it('keeps arbitrary mini-app scripts disabled until the user explicitly enables the sandbox', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'app-1',
      mime: 'text/html',
      title: 'Mini calculator',
      data: '<button id="go">Calculate</button><script>document.getElementById("go").onclick=()=>document.body.dataset.clicked="1"</script>',
    })} />)

    const frame = screen.getByTitle('Mini calculator')
    expect(frame.getAttribute('sandbox')).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Enable sandboxed interaction' }))
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(screen.getByText(/network, forms, popups and parent access blocked/i)).toBeTruthy()
  })

  it('keeps preview controls without duplicate artifact chrome', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'app-2',
      mime: 'text/html',
      title: 'Canvas demo',
      data: '<h1>Ready</h1>',
    })} />)

    expect(document.querySelector('header')).toBeNull()
    expect(document.querySelector('img[src="/phoenix-emblem.png"]')).toBeNull()
    const frame = screen.getByTitle('Canvas demo')
    expect(screen.getAllByText('Loading preview').length).toBeGreaterThan(0)
    fireEvent.load(frame)
    expect(screen.getAllByText('Preview ready').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: 'Reload preview' }).at(-1)!)
    expect(screen.getAllByText('Loading preview').length).toBeGreaterThan(0)
  })

  it('lets an HTML preview grow beyond the old compact height cap', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'app-tall',
      mime: 'text/html',
      title: 'Tall report',
      data: '<main style="height:980px">Report</main>',
    })} />)

    const frame = screen.getByTitle('Tall report') as HTMLIFrameElement
    fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'phoenix-artifact-height', height: 980 },
    }))

    expect(frame.style.height).toBe('980px')
  })

  it('renders a Codex image attachment through the session image slot', () => {
    const attachment = {
      attachmentId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mediaType: 'image/png', bytes: 4, width: 1, height: 1, name: 'generated.png',
    }
    const renderMessageImages = vi.fn(() => <div data-testid="artifact-images" />)
    render(<HardnessArtifactNodeView
      {...props({
        artifactId: 'image-1',
        mime: 'image/png',
        title: 'HARDNESS result',
        data: { provider: 'codex', model: 'codex-built-in-image-gen', attachment },
      })}
      renderMessageImages={renderMessageImages}
    />)

    expect(screen.getByTestId('artifact-images')).toBeTruthy()
    expect(screen.queryByText(/"provider": "codex"/)).toBeNull()
    expect(renderMessageImages).toHaveBeenCalledWith({ images: [{ attachment }], align: 'start' })
  })

  it('normalizes complete HTML documents before placing them in srcDoc', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'app-3',
      mime: 'text/html',
      title: 'Complete document',
      data: '<!doctype html><html><head><style>body{color:red}</style></head><body><h1>Ready</h1></body></html>',
    })} />)

    const frame = screen.getByTitle('Complete document')
    const srcDoc = frame.getAttribute('srcdoc') ?? ''
    expect(srcDoc).not.toMatch(/<body>\s*<!doctype/i)
    expect(srcDoc).toContain('<h1>Ready</h1>')
    expect(srcDoc).toContain('body{color:red}')
    expect(srcDoc).toContain("font-src data:; style-src 'unsafe-inline';")
    expect(srcDoc).not.toContain("font-src data: style-src")
    expect(srcDoc).toContain('min-height:0')
  })
})
