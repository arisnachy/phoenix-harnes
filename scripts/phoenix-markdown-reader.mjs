#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function localAppData(env = process.env) {
  const configured = env.LOCALAPPDATA?.trim()
  if (configured) return configured
  return join(homedir(), 'AppData', 'Local')
}

function safeHref(value, sourceDirectory) {
  const raw = String(value ?? '').trim()
  if (raw.length === 0) return '#'
  if (/^(?:https?:|mailto:|data:|file:|#)/iu.test(raw)) return raw
  return pathToFileURL(resolve(sourceDirectory, raw)).href
}

function firstHeading(tree) {
  const heading = tree.children.find(node => node.type === 'heading')
  if (!heading) return undefined
  return heading.children
    .filter(node => node.type === 'text' || node.type === 'inlineCode')
    .map(node => node.value)
    .join('')
    .trim() || undefined
}

function definitionMap(tree) {
  return new Map(tree.children
    .filter(node => node.type === 'definition')
    .map(node => [String(node.identifier).toLowerCase(), node]))
}

function renderMarkdown(tree, sourceDirectory) {
  const definitions = definitionMap(tree)

  function renderChildren(node, context = {}) {
    return Array.isArray(node.children)
      ? node.children.map((child, index) => renderNode(child, { ...context, index })).join('')
      : ''
  }

  function renderReference(node, image) {
    const definition = definitions.get(String(node.identifier ?? '').toLowerCase())
    if (!definition) return image ? '' : escapeHtml(node.label ?? node.identifier ?? '')
    const href = safeHref(definition.url, sourceDirectory)
    if (image) {
      const alt = escapeHtml(node.alt ?? node.label ?? '')
      return `<img src="${escapeHtml(href)}" alt="${alt}" loading="lazy">`
    }
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${renderChildren(node)}</a>`
  }

  function renderNode(node, context = {}) {
    switch (node.type) {
      case 'root':
        return renderChildren(node)
      case 'text':
        return escapeHtml(node.value)
      case 'paragraph':
        return `<p>${renderChildren(node)}</p>`
      case 'heading': {
        const depth = Math.min(6, Math.max(1, Number(node.depth) || 1))
        return `<h${depth}>${renderChildren(node)}</h${depth}>`
      }
      case 'strong':
        return `<strong>${renderChildren(node)}</strong>`
      case 'emphasis':
        return `<em>${renderChildren(node)}</em>`
      case 'delete':
        return `<del>${renderChildren(node)}</del>`
      case 'inlineCode':
        return `<code>${escapeHtml(node.value)}</code>`
      case 'code': {
        const language = node.lang ? ` data-language="${escapeHtml(node.lang)}"` : ''
        return `<pre><code${language}>${escapeHtml(node.value)}</code></pre>`
      }
      case 'blockquote':
        return `<blockquote>${renderChildren(node)}</blockquote>`
      case 'thematicBreak':
        return '<hr>'
      case 'break':
        return '<br>'
      case 'link': {
        const href = safeHref(node.url, sourceDirectory)
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${renderChildren(node)}</a>`
      }
      case 'image': {
        const src = safeHref(node.url, sourceDirectory)
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(node.alt ?? '')}" loading="lazy">`
      }
      case 'linkReference':
        return renderReference(node, false)
      case 'imageReference':
        return renderReference(node, true)
      case 'list': {
        const tag = node.ordered ? 'ol' : 'ul'
        const start = node.ordered && Number.isInteger(node.start) && node.start !== 1
          ? ` start="${String(node.start)}"`
          : ''
        return `<${tag}${start}>${renderChildren(node)}</${tag}>`
      }
      case 'listItem': {
        const task = typeof node.checked === 'boolean'
          ? `<input type="checkbox" disabled ${node.checked ? 'checked' : ''} aria-label="task"> `
          : ''
        return `<li>${task}${renderChildren(node)}</li>`
      }
      case 'table':
        return `<div class="table-wrap"><table>${renderChildren(node, { table: true })}</table></div>`
      case 'tableRow': {
        const cells = Array.isArray(node.children)
          ? node.children.map((cell, index) => renderNode(cell, {
              tableCellTag: context.index === 0 ? 'th' : 'td',
              index,
            })).join('')
          : ''
        return `<tr>${cells}</tr>`
      }
      case 'tableCell': {
        const tag = context.tableCellTag ?? 'td'
        return `<${tag}>${renderChildren(node)}</${tag}>`
      }
      case 'html':
        return `<pre class="raw-html"><code>${escapeHtml(node.value)}</code></pre>`
      case 'definition':
        return ''
      default:
        return renderChildren(node)
    }
  }

  return renderNode(tree)
}

export function markdownDocument(markdown, sourcePath) {
  const sourceDirectory = dirname(sourcePath)
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
  const title = firstHeading(tree) ?? basename(sourcePath)
  const content = renderMarkdown(tree, sourceDirectory)
  const sourceUrl = pathToFileURL(sourcePath).href

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Phoenix Markdown</title>
<style>
:root{color-scheme:light dark;font-family:Inter,Segoe UI,system-ui,sans-serif;background:#f2efe9;color:#2a2723}
*{box-sizing:border-box}
body{margin:0;background:#f2efe9;color:#2a2723}
.shell{max-width:980px;margin:0 auto;padding:28px 22px 72px}
.top{position:sticky;top:0;z-index:5;margin:-28px -22px 28px;padding:16px 22px;background:rgba(242,239,233,.94);backdrop-filter:blur(12px);border-bottom:1px solid #ddd8cd}
.brand{display:flex;align-items:center;gap:10px;font-weight:750;letter-spacing:.01em}
.phoenix{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#f59e0b;color:#fff;font-size:18px;box-shadow:0 5px 18px rgba(245,158,11,.25)}
.path{margin-top:6px;font-size:12px;color:#746f68;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
article{background:#f9f7f3;border:1px solid #ddd8cd;border-radius:18px;padding:34px 38px;box-shadow:0 12px 34px rgba(42,39,35,.06);line-height:1.7}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.35em 0 .55em}
h1{font-size:2rem;margin-top:0} h2{font-size:1.5rem;border-bottom:1px solid #e5e0d7;padding-bottom:.3em}
p,ul,ol,blockquote,pre,.table-wrap{margin:1em 0}
code{font-family:Cascadia Code,Consolas,monospace;background:#ebe7df;border-radius:6px;padding:.12em .35em;font-size:.92em}
pre{overflow:auto;background:#2a2723;color:#f9f7f3;padding:18px;border-radius:12px}
pre code{background:transparent;padding:0;color:inherit}
blockquote{margin-left:0;padding:.2em 1em;border-left:4px solid #f59e0b;background:#f4efe5;border-radius:0 10px 10px 0}
a{color:#9a5a00;text-decoration-thickness:1px;text-underline-offset:3px}
img{max-width:100%;height:auto;border-radius:10px}
.table-wrap{overflow:auto;border:1px solid #ddd8cd;border-radius:12px}
table{width:100%;border-collapse:collapse;background:#fff}
th,td{padding:10px 12px;border-bottom:1px solid #e8e3da;text-align:left;vertical-align:top}
th{background:#eee9df}
hr{border:0;border-top:1px solid #ddd8cd;margin:2em 0}
.raw-html{opacity:.8}
@media(max-width:640px){.shell{padding:16px 10px 48px}.top{margin:-16px -10px 18px;padding:12px 10px}article{padding:24px 18px;border-radius:14px}}
@media(prefers-color-scheme:dark){:root,body{background:#1f1d1a;color:#eee9df}.top{background:rgba(31,29,26,.94);border-color:#403c36}.path{color:#aaa39a}article{background:#292621;border-color:#403c36;box-shadow:none}code{background:#37332d}blockquote{background:#302c26}table{background:#292621}th{background:#34302a}th,td{border-color:#403c36}a{color:#f7ad31}}
</style>
</head>
<body>
<div class="shell">
  <header class="top">
    <div class="brand"><span class="phoenix">◆</span><span>Phoenix Markdown</span></div>
    <div class="path"><a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourcePath)}</a></div>
  </header>
  <article>${content}</article>
</div>
</body>
</html>`
}

function main() {
  const input = process.argv[2]
  if (!input) throw new Error('Usage: node scripts/phoenix-markdown-reader.mjs <file.md>')
  const sourcePath = resolve(input)
  const extension = extname(sourcePath).toLowerCase()
  if (!['.md', '.markdown'].includes(extension)) throw new Error(`Unsupported Markdown extension: ${extension || '(none)'}`)
  if (!existsSync(sourcePath)) throw new Error(`Markdown file does not exist: ${sourcePath}`)

  const markdown = readFileSync(sourcePath, 'utf8')
  const html = markdownDocument(markdown, sourcePath)
  const outputRoot = join(localAppData(), 'Phoenix', 'markdown-viewer')
  mkdirSync(outputRoot, { recursive: true })
  const key = createHash('sha256').update(sourcePath).digest('hex').slice(0, 20)
  const outputPath = join(outputRoot, `${key}.html`)
  writeFileSync(outputPath, html, 'utf8')
  process.stdout.write(outputPath)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/u, ''))) {
  main()
}
