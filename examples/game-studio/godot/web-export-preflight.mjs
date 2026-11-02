#!/usr/bin/env node
/**
 * Validates the real multi-file shape of a Godot Web export BEFORE attempting to
 * embed it into Phoenix. No browser/rendering success is inferred from bytes.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_FILE_BYTES = 1024 * 1024 * 1024
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024

function regularFileInside(root, name) {
  const target = join(root, name)
  if (!existsSync(target)) throw new Error('Godot Web export is missing ' + name)
  const real = realpathSync(target)
  if (dirname(real) !== root) throw new Error('Godot Web asset must remain inside the export folder: ' + name)
  const stats = statSync(real)
  if (!stats.isFile() || stats.size === 0 || stats.size > MAX_FILE_BYTES) {
    throw new Error('Godot Web asset is empty, not a regular file or too large: ' + name)
  }
  return { target: real, bytes: stats.size }
}

/**
 * A complete export, not its index.html alone, is required for actual Web playback.
 * @returns package structure and explicit pending browser validation.
 */
function magic(file) {
  const handle = openSync(file, 'r')
  try {
    const head = Buffer.alloc(4)
    if (readSync(handle, head, 0, 4, 0) !== 4) throw new Error('Truncated binary export: ' + file)
    return head
  } finally { closeSync(handle) }
}

export function inspectGodotWebExport(directory, entry = 'index.html') {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('Export directory required')
  if (typeof entry !== 'string' || !/^[\w.-]+\.html$/iu.test(entry) || entry.includes('..')) {
    throw new Error('Godot Web entry must be a simple .html filename')
  }
  const root = realpathSync(resolve(directory))
  if (!statSync(root).isDirectory()) throw new Error('Godot Web export path must be a directory')
  const stem = basename(entry, '.html')
  const suffixes = ['.html', '.js', '.wasm', '.pck']
  const found = suffixes.map(suffix => regularFileInside(root, stem + suffix))
  const total = found.reduce((sum, item) => sum + item.bytes, 0)
  if (total > MAX_TOTAL_BYTES) throw new Error('Godot Web export package exceeds 2 GiB')
  const html = readFileSync(found[0].target, 'utf8')
  const js = readFileSync(found[1].target, 'utf8')
  const wasm = magic(found[2].target)
  const pack = magic(found[3].target)
  if (!/(?:new\s+Engine\b|\bGODOT_CONFIG\b)/u.test(html) || !html.includes(stem + '.js')) {
    throw new Error('Entry HTML does not match a Godot Web bootstrap and its script')
  }
  if (!/\bEngine\b/u.test(js)) throw new Error('Missing Godot JavaScript engine loader')
  if (!wasm.equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))) throw new Error('Invalid WebAssembly magic')
  if (!pack.equals(Buffer.from('GDPC', 'ascii'))) throw new Error('Invalid Godot PCK header')
  return {
    engine: 'godot', entry, root, files: suffixes.map((suffix, index) => ({
      path: stem + suffix, bytes: found[index].bytes,
    })),
    totalBytes: total,
    packageStructureVerified: true,
    browserPlaybackVerified: false,
    embeddedInPhoenixChat: false,
    deliveryNote: 'Serve the whole export from a scoped, isolated HTTP origin. WebGL2/Compatibility and real iframe playback must still be checked.',
  }
}

function cli() {
  const [directory, entry = 'index.html', ...extra] = process.argv.slice(2)
  if (extra.length || !directory) throw new Error('Usage: node web-export-preflight.mjs EXPORT_DIRECTORY [index.html]')
  const result = inspectGodotWebExport(directory, entry)
  process.stdout.write(JSON.stringify(result) + '\n')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli() } catch (error) {
    process.stderr.write(JSON.stringify({ status: 'blocked', error: String(error instanceof Error ? error.message : error) }) + '\n')
    process.exitCode = 1
  }
}
