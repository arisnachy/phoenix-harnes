import { parseCanvasSpec, type CanvasSpec } from './GenerativeCanvas.tsx'

/**
 * Provider-neutral, presentation-only fallback. Read one unambiguous two-column
 * time series or category comparison from ordinary Markdown, retaining the original table in the chat.
 * Do not infer units, numbers, missing points, provenance or verification.
 * @param markdown - Complete visible assistant text.
 * @returns A validated native bar chart, or null when the data is ambiguous.
 */
export function responseTableChart(markdown: string): CanvasSpec | null {
  if (markdown.length > 40_000 || /`{3}|~{3}/u.test(markdown)) return null
  const lines = markdown.split(/\r?\n/u)
  const cells = (line: string): string[] | null => {
    const value = line.trim()
    if (!value.startsWith('|') || !value.endsWith('|') || value.includes('\\|')) return null
    const row = value.slice(1, -1).split('|').map(cell => cell.trim())
    return row.length === 2 ? row : null
  }
  for (let i = 0; i + 2 < lines.length; i++) {
    const header = cells(lines[i] ?? '')
    const divider = cells(lines[i + 1] ?? '')
    if (!header || !divider || !divider.every(cell => /^:?-{3,}:?$/u.test(cell))) continue
    if (!/^(?:año|year|mes|month|fecha|date|per[ií]odo|period|trimestre|quarter|categor[ií]a|category|grupo|group|regi[oó]n|region|pa[ií]s|country|producto|product|servicio|service|departamento|department)$/iu.test(header[0] ?? '')) continue
    const title = header[1] ?? ''
    if (!title || title.length > 100 || /[<>{}\[\]*]/u.test(title)) continue
    const points: Array<{ label: string; value: number }> = []
    const labels = new Set<string>()
    let j = i + 2
    for (; j < lines.length && (lines[j] ?? '').trim().startsWith('|'); j++) {
      const row = cells(lines[j] ?? '')
      if (!row || points.length >= 20) break
      const [label = '', raw = ''] = row
      // Integers only: commas and periods are locale-ambiguous. No silent
      // stripping of units, missing values, negative quantities or footnotes.
      if (!label || label.length > 60 || /[<>{}\[\]*]/u.test(label) || labels.has(label)
        || !/^(?:0|[1-9][0-9]{0,11})$/u.test(raw)) break
      labels.add(label)
      points.push({ label, value: Number(raw) })
    }
    if ((lines[j] ?? '').trim().startsWith('|') || points.length < 2) continue
    return parseCanvasSpec({
      component: 'ui_canvas', version: 1,
      props: { title, children: [{ type: 'chart', points }] },
    })
  }
  return null
}
