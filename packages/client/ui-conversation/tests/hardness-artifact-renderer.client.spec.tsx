import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HardnessArtifactNodeView } from '../src/client/chat/HardnessArtifactNodeView.tsx'

function props(data: { readonly artifactId: string; readonly mime: string; readonly title: string; readonly data: string | Readonly<Record<string, unknown>> }) {
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
  } as never
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
})
