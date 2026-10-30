/**
 * Presentation-only repair for peer messages whose author flattened an entire
 * GFM table into a single line. MarkdownText already supports valid GFM; this
 * adapter only restores the row boundaries of a recognisable table.
 *
 * Do not mutate the event / replay text. Never reinterpret fenced code, prose
 * containing pipes, or partial table-like output.
 */
const separator = /^\|(?:[ \t]*:?-{3,}:?[ \t]*\|){2,}[ \t]*$/u
const splitBoundary = /\|[ \t]+(?=\|)/gu
const flattenedSeparator = /\|[ \t]+(?=\|(?:[ \t]*:?-{3,}:?[ \t]*\|){2,})/u
const fenceStart = /^[ \t]{0,3}(`{3,}|~{3,})/u

/**
 * Restore flattened GFM table rows without changing the durable source.
 * @param source - Original durable peer-message text.
 * @returns A display-only string with recognisable table row boundaries restored.
 */
export function formatTeamMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n')
  const result: string[] = []
  let fence: { marker: string; length: number } | undefined

  for (const line of lines) {
    const match = fenceStart.exec(line)
    if (match) {
      const marker = match[1] ?? ''
      if (fence === undefined) fence = { marker: marker[0] ?? '', length: marker.length }
      else if (marker[0] === fence.marker && marker.length >= fence.length) fence = undefined
      result.push(line)
      continue
    }
    if (fence !== undefined || !flattenedSeparator.test(line)) {
      result.push(line)
      continue
    }

    // A canonical row boundary is "end-of-row |  | start-of-next-row".
    // Only treat it as structural when the second row is a GFM dash row.
    const rows = line.replace(splitBoundary, '|\n').split('\n')
    const delim = rows[1] ?? ''
    const first = rows[0] ?? ''
    const headerStart = first.indexOf('|')
    const header = headerStart < 0 ? '' : first.slice(headerStart).trim()
    const columns = (header.match(/\|/gu)?.length ?? 0) - 1
    const dashes = delim.match(/-{3,}/gu)?.length ?? 0
    if (!separator.test(delim) || columns < 2 || columns !== dashes) {
      result.push(line)
      continue
    }

    const preamble = first.slice(0, headerStart).trimEnd()
    if (preamble !== '') result.push(preamble, '')
    result.push(header, ...rows.slice(1).map(row => row.trim()))
  }
  return result.join('\n')
}
