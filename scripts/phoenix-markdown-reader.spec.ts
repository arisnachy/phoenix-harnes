import { describe, expect, it } from 'vitest'
import { markdownDocument } from './phoenix-markdown-reader.mjs'

describe('Phoenix Markdown reader', () => {
  it('renders common Markdown without exposing raw HTML', () => {
    const html = markdownDocument([
      '# Informe',
      '',
      '**Importante** y [enlace](https://example.com).',
      '',
      '- [x] Hecho',
      '',
      '<script>alert("x")</script>',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
    ].join('\n'), 'C:\\Docs\\informe.md')

    expect(html).toContain('<h1>Informe</h1>')
    expect(html).toContain('<strong>Importante</strong>')
    expect(html).toContain('type="checkbox" disabled checked')
    expect(html).toContain('<table>')
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Phoenix Markdown')
  })
})
