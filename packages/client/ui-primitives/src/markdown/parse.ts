/**
 * The markdown renderer's two mdast grammars, one per rendering arm. Each
 * arm is internally consistent — the incremental tail parses, the one-shot
 * parses, and the plain-text projection of a given grammar always agree on
 * where blocks start and end — and the settled grammar is the streaming one
 * plus the math extensions, so the arms differ only where TeX delimiters
 * begin a math construct (a `$$` block is a paragraph while streaming and a
 * math block once settled, by design).
 */

import type { Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import { cjkFriendlyStrong } from './cjkFriendlyStrong.ts'
import { mathCompatibility } from './mathCompatibility.ts'

/**
 * Parse GFM markdown (the streaming arm's grammar: no math, so incomplete
 * TeX never flashes KaTeX errors mid-stream).
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfm(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong()],
    mdastExtensions: [gfmFromMarkdown()],
  })
}

/**
 * A currency value such as RD$23,730 or US$25,628.40 is not TeX. If a
 * settled reply has two prices, micromark otherwise swallows all text between
 * their dollar signs as one inline formula, collapsing word spacing in KaTeX.
 *
 * Only escape literal price markers from GFM text nodes: fenced code,
 * inline code, links' destinations and real $x+2$ formula delimiters retain
 * their existing grammar. The initial lightweight GFM parse only runs for
 * messages containing a plausible price marker.
 *
 * @param source - Untrusted Markdown with intact original whitespace.
 * @returns Markdown with price dollars escaped for the math-only parse.
 */
export function protectCurrencyInMarkdown(source: string): string {
  if (!/\$\d/u.test(source)) return source
  const root = parseGfm(source)
  const dollarOffsets: number[] = []
  const price = /(?<!\\)\$(?=(?:\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?=$|[\s.,;:!?)}\]]))/gu
  const walk = (node: Root | Root['children'][number]): void => {
    if (node.type === 'text') {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) {
        const literal = source.slice(start, end)
        for (const found of literal.matchAll(price)) {
          dollarOffsets.push(start + (found.index ?? 0))
        }
      }
    }
    if ('children' in node) {
      for (const child of node.children) walk(child as Root['children'][number])
    }
  }
  walk(root)
  if (dollarOffsets.length === 0) return source
  let escaped = source
  for (const offset of dollarOffsets.sort((a, b) => b - a)) {
    escaped = escaped.slice(0, offset) + '\\' + escaped.slice(offset)
  }
  return escaped
}

/**
 * Parse GFM markdown plus TeX math with the compatibility delimiters
 * (the settled arm's grammar).
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfmWithMath(text: string): Root {
  return fromMarkdown(protectCurrencyInMarkdown(text), {
    extensions: [gfm(), cjkFriendlyStrong(), mathCompatibility(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
}
