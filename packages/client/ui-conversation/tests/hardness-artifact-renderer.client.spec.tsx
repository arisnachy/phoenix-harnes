// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HardnessArtifactNodeView } from '../src/client/chat/HardnessArtifactNodeView.tsx'

function props(data: {
  readonly artifactId: string
  readonly mime: string
  readonly title: string
  readonly data: string | Readonly<Record<string, unknown>>
  readonly executable?: boolean
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
  afterEach(() => { cleanup() })
  it('opens a real large dialog instead of merely changing inline height', () => {
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
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(expand)

    const dialog = screen.getByRole('dialog', { name: 'Vista ampliada: Results' })
    expect((dialog as HTMLDialogElement).open).toBe(true)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.querySelector('table')).toBeTruthy()
    expect(document.querySelector('[data-artifact-height="expanded"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Collapse' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('table')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect((dialog as HTMLDialogElement).open).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Expand' })).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
  })

  it('enlarges a donut visualization in the dialog and restores it on Escape/cancel', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'pie-1',
      mime: 'application/vnd.phoenix.visual+json',
      title: 'Gráfico de pastel de ejemplo',
      data: {
        visualType: 'chart', chartType: 'donut', xKey: 'label',
        series: [{ dataKey: 'value', label: 'Valor ficticio' }],
        data: [
          { label: 'Lun', value: 38 }, { label: 'Mar', value: 51 },
          { label: 'Mié', value: 47 }, { label: 'Jue', value: 65 },
        ],
      },
    })} />)
    expect(screen.getByRole('img', { name: 'donut chart' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    const dialog = screen.getByRole('dialog', { name: /Vista ampliada: Gráfico de pastel/i })
    expect(dialog.querySelector('[data-phoenix-chart-type="donut"]')).toBeTruthy()
    expect(dialog.querySelectorAll('[data-phoenix-visual-mark="donut-slice"]')).toHaveLength(4)
    expect(screen.getAllByRole('img', { name: 'donut chart' })).toHaveLength(1)
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
    expect((dialog as HTMLDialogElement).open).toBe(false)
    expect(screen.getByRole('button', { name: 'Expand' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'donut chart' })).toBeTruthy()
  })

  it('renders a Phoenix canvas inline in chat and auto-fits its reported content height', () => {
    const openCanvas = vi.fn(() => true)
    render(<HardnessArtifactNodeView
      {...props({
        artifactId: 'canvas-1',
        mime: 'application/vnd.phoenix.canvas+html',
        title: 'Floral dream',
        data: '<main style="height:760px"><canvas id="art"></canvas></main><script>document.body.dataset.ready="1"</script>',
        executable: true,
      })}
      openCanvas={openCanvas}
    />)

    const frame = screen.getByTitle('Floral dream') as HTMLIFrameElement
    expect(openCanvas).not.toHaveBeenCalled()
    expect(document.querySelector('[data-canvas-workspace-launcher]')).toBeNull()
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain('phoenix-artifact-height')

    fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'phoenix-artifact-height', height: 760 },
    }))
    expect(frame.style.height).toBe('760px')
  })

  it('shows MCP status rows from record-shaped visual data instead of blank cells', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'mcp-rows-1',
      mime: 'application/vnd.phoenix.visual+json',
      title: 'Estado de conectores MCP',
      data: {
        visualType: 'table',
        columns: ['Estado', 'Conectores', 'Cantidad'],
        rows: [
          { Estado: 'Conectado', Conectores: 'GitHub', Cantidad: 1 },
          { Estado: 'Requiere autorización', Conectores: 'Canva', Cantidad: 1 },
        ],
      },
    })} />)
    const rows = screen.getByRole('table').querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('Conectado')
    expect(rows[0]?.textContent).toContain('GitHub')
    expect(rows[1]?.textContent).toContain('Canva')
    expect(document.querySelector('[data-phoenix-visual-qa="fail"]')).toBeNull()
  })

  it('refuses to present MCP status placeholder rows as a valid table', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'mcp-blank-1',
      mime: 'application/vnd.phoenix.visual+json',
      title: 'Estado de conectores MCP',
      data: { visualType: 'table', columns: ['Estado', 'Conectores', 'Cantidad'],
        rows: [{}, {}, {}] },
    })} />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText(/La tabla no contiene datos verificables/)).toBeTruthy()
    expect(document.querySelector('[data-phoenix-visual-qa="fail"]')).toBeTruthy()
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

  it('renders Binance candlesticks from nested market data instead of raw JSON', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'btc-candles-1',
      mime: 'application/vnd.phoenix.visual+json',
      title: 'BTC/USDT · Velas de 1 hora',
      data: {
        visualType: 'chart',
        chartType: 'candlestick',
        data: {
          symbol: 'BTCUSDT',
          interval: '1h',
          candles: [
            { time: 1790488800000, open: 84478.06, high: 84636.91, low: 84478.06, close: 84511.69 },
            { time: 1790492400000, open: 84511.69, high: 84720.12, low: 84392.4, close: 84680.55 },
          ],
        },
      },
    })} />)

    expect(document.querySelector('[data-phoenix-chart-type="candlestick"]')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'candlestick chart' })).toBeTruthy()
    expect(screen.queryByText(/"visualType"/)).toBeNull()
    expect(screen.queryByText(/"candles"/)).toBeNull()
  })

  it('renders a simple fictional line chart successfully on the first pass', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'synthetic-line-1',
      mime: 'application/vnd.phoenix.visual+json',
      title: 'Tendencia ficticia',
      data: {
        visualType: 'chart',
        chartType: 'line',
        description: 'Datos ficticios · ejemplo demostrativo, no mediciones reales',
        xKey: 'label',
        series: [{ dataKey: 'value', label: 'Valor ficticio' }],
        data: [
          { label: 'Lun', value: 38 },
          { label: 'Mar', value: 51 },
          { label: 'Mié', value: 47 },
          { label: 'Jue', value: 65 },
        ],
      },
    })} />)
    expect(screen.getByRole('img',{ name:'line chart' })).toBeTruthy()
    expect(document.querySelectorAll('[data-phoenix-visual-mark="line-point"]')).toHaveLength(4)
    expect(document.querySelector('[data-phoenix-visual-qa="fail"]')).toBeNull()
    expect(screen.getByText(/Datos ficticios/)).toBeTruthy()
  })

  it('blocks malformed charts instead of exposing raw visualization JSON', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'broken-candles-1',
      mime: 'application/vnd.phoenix.visual+json',
      title: 'Broken candles',
      data: {
        visualType: 'chart',
        chartType: 'candlestick',
        candles: [
          { time: 1790488800000, open: 100, high: 90, low: 80, close: 95 },
        ],
      },
    })} />)

    expect(document.querySelector('[data-phoenix-visual-qa="fail"]')).toBeTruthy()
    expect(screen.getByText(/No se pudo representar esta gráfica/)).toBeTruthy()
    expect(screen.queryByText(/"chartType"/)).toBeNull()
    expect(screen.queryByText(/"candles"/)).toBeNull()
  })

  it('renders sports scoreboards as a dedicated rich visual instead of raw JSON', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'sports-1',
      mime: 'application/vnd.phoenix.visual+json',
      title: 'NBA scores',
      data: {
        visualType: 'sports',
        title: 'NBA · Tonight',
        games: [
          {
            league: 'NBA',
            status: 'Final',
            away: { name: 'Boston Celtics', abbreviation: 'BOS', score: 108, record: '52-18' },
            home: { name: 'New York Knicks', abbreviation: 'NYK', score: 104, record: '47-23' },
          },
        ],
      },
    })} />)

    expect(document.querySelector('[data-phoenix-visual-kind="sports"]')).toBeTruthy()
    expect(screen.getByText('Boston Celtics')).toBeTruthy()
    expect(screen.getByText('New York Knicks')).toBeTruthy()
    expect(screen.getByText('108')).toBeTruthy()
    expect(screen.getByText('104')).toBeTruthy()
    expect(screen.queryByText(/"visualType"/)).toBeNull()
  })

  it('renders sports standings with team identity and ranking columns', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'standings-1',
      mime: 'application/vnd.phoenix.visual+json',
      title: 'Conference standings',
      data: {
        visualType: 'standings',
        standings: [
          { rank: 1, team: { name: 'Boston Celtics', abbreviation: 'BOS' }, record: '52-18', pct: '.743', gb: '—', streak: 'W3' },
          { rank: 2, team: { name: 'New York Knicks', abbreviation: 'NYK' }, record: '47-23', pct: '.671', gb: '5.0', streak: 'W1' },
        ],
      },
    })} />)

    expect(document.querySelector('[data-phoenix-visual-kind="standings"]')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('Conference standings')).toBeTruthy()
    expect(screen.getByText('52-18')).toBeTruthy()
    expect(screen.queryByText(/"standings"/)).toBeNull()
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
      mime: 'text/plain',
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

  it('runs HTML scripts by default so generated mini-app controls stay interactive', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'app-1',
      mime: 'text/html',
      title: 'Mini calculator',
      data: '<button id="go">Calculate</button><script>document.getElementById("go").onclick=()=>document.body.dataset.clicked="1"</script>',
    })} />)

    const frame = screen.getByTitle('Mini calculator')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain("connect-src 'none'")
    expect(screen.queryByRole('button', { name: /sandboxed interaction/i })).toBeNull()
  })

  it('explains blocked remote Chart.js dependencies instead of silently showing an empty canvas', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'external-chart-1', mime: 'text/html', title: 'grafica.html',
      data: '<h1>Gráfica ficticia</h1><canvas id="chart"></canvas>'
        + '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>'
        + '<script>new Chart(document.getElementById("chart"),{});</script>',
    })} />)
    const frame = screen.getByTitle('grafica.html') as HTMLIFrameElement
    expect(frame.getAttribute('srcdoc')).toContain('biblioteca externa bloqueada')
    expect(frame.getAttribute('srcdoc')).toContain('phoenix_visualize')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain("connect-src 'none'")
  })

  it('does not warn for fully self-contained HTML charts', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'inline-chart-1', mime: 'text/html', title: 'grafica-autonoma.html',
      data: '<h1>Gráfica ficticia</h1><canvas id="chart"></canvas><script>document.body.dataset.ok="1"</script>',
    })} />)
    const frame = screen.getByTitle('grafica-autonoma.html') as HTMLIFrameElement
    expect(frame.getAttribute('srcdoc')).not.toContain('biblioteca externa bloqueada')
  })

  it('preserves an explicit static HTML opt-out with scripts disabled', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'app-static',
      mime: 'text/html',
      title: 'Static report',
      data: '<button>Decorative only</button><script>document.body.dataset.clicked="1"</script>',
      executable: false,
    })} />)

    const frame = screen.getByTitle('Static report')
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')
  })

  it('renders a live web page inside the same artifact viewer when Phoenix emits a page preview', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'page-1',
      mime: 'application/vnd.phoenix.web-preview+json',
      title: 'Phoenix page preview',
      data: { url: 'https://example.test/app', title: 'Example app' },
    })} />)

    const frame = screen.getByTitle('Example app')
    expect(frame.getAttribute('src')).toBe('https://example.test/app')
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts')
    expect(frame.getAttribute('sandbox')).toContain('allow-forms')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(screen.getByRole('link', { name: 'Open page' }).getAttribute('href')).toBe('https://example.test/app')
  })

  it('renders HTML with only the filename and content, without preview chrome', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'app-2',
      mime: 'text/html',
      title: 'Canvas demo',
      data: '<h1>Ready</h1>',
    })} />)

    expect(screen.getByText('Canvas demo')).toBeTruthy()
    expect(screen.queryByText(/^HTML$/i)).toBeNull()
    expect(screen.queryByText(/Preview ready|Loading preview/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Reload preview/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Copy/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Download/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Expand|Collapse/i })).toBeNull()
  })

  it('lets an HTML preview size itself to reported content height without a compact cap', () => {
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
    expect(srcDoc).not.toContain('font-src data: style-src')
    expect(srcDoc).toContain('min-height:0')
  })
})
