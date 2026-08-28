// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'
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

    expect(screen.getByText('Results')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    const expand = screen.getByRole('button', { name: 'Expand' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(expand)
    expect(screen.getByRole('button', { name: 'Collapse' }).getAttribute('aria-expanded')).toBe('true')
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

  it('shows the PHOENIX mark and an explicit preview-ready reload trigger', () => {
    render(<HardnessArtifactNodeView {...props({
      artifactId: 'app-2',
      mime: 'text/html',
      title: 'Canvas demo',
      data: '<h1>Ready</h1>',
    })} />)

    expect(document.querySelector('img[src="/phoenix-emblem.png"]')).toBeTruthy()
    const frame = screen.getByTitle('Canvas demo')
    expect(screen.getAllByText('Loading preview').length).toBeGreaterThan(0)
    fireEvent.load(frame)
    expect(screen.getAllByText('Preview ready').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: 'Reload preview' }).at(-1)!)
    expect(screen.getAllByText('Loading preview').length).toBeGreaterThan(0)
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
    expect(srcDoc).toContain('min-height:0')
  })
})
