/** Ordered JSONL loading shared by the two memory ledgers. */

import { readFile } from 'node:fs/promises'

/**
 * Read rows synchronously after the file read, preserving partial application on a later invalid row.
 * @param path - Owned ledger path; a missing file is empty.
 * @param rowLabel - Ledger-specific prefix for malformed JSON diagnostics.
 * @param apply - Validate and apply each parsed row with its one-based physical line number.
 * @returns Resolves after every nonblank row has been applied.
 */
export async function readJsonl(
  path: string,
  rowLabel: string,
  apply: (row: unknown, lineNumber: number) => void,
): Promise<void> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch (error: unknown) {
      throw new Error(`${rowLabel} ${index + 1} is not valid JSON`, { cause: error })
    }
    apply(row, index + 1)
  }
}
