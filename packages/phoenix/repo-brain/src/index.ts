/**
 * PHOENIX Repo Brain — deterministic, incremental repository structure index.
 * It spends zero model tokens: unchanged files are not reread, repository
 * retrieval is lexical/structural, and impact follows the reverse import graph.
 * @module @deepseek-ai/dsh-phoenix-repo-brain
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { open, readdir, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'

const DEFAULT_MAX_FILES = 20_000
const DEFAULT_MAX_FILE_BYTES = 262_144
const DEFAULT_MAX_TERMS_PER_FILE = 2_048
const DEFAULT_LIMIT = 12
const MAX_TOOL_LIMIT = 50
const MAX_IMPACT_DEPTH = 8

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.rs', '.go', '.java', '.kt', '.kts', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.cs', '.swift', '.rb', '.php', '.scala', '.sh', '.ps1', '.sql', '.md', '.mdx',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.vue', '.svelte',
])

const IMPORTABLE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json',
]

const SKIP_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'lib', 'coverage', '.coverage',
  '.next', '.nuxt', '.cache', 'build', 'out', 'target', '.turbo', '.vite',
])

export interface RepoBrainConfig {
  root?: string
  maxFiles?: number
  maxFileBytes?: number
  maxTermsPerFile?: number
  defaultLimit?: number
}

interface ResolvedRepoBrainConfig {
  root: string
  maxFiles: number
  maxFileBytes: number
  maxTermsPerFile: number
  defaultLimit: number
}

interface FileFingerprint {
  mtimeMs: number
  size: number
}

interface RepoEntry extends FileFingerprint {
  path: string
  symbols: string[]
  terms: string[]
  importSpecs: string[]
  imports: string[]
}

export interface RepoBrainSearchHit {
  path: string
  score: number
  symbols: string[]
}

export interface RepoBrainImpactHit {
  path: string
  depth: number
}

export interface RepoBrainRefreshSummary {
  files: number
  reread: number
  reused: number
  removed: number
  truncated: boolean
}

export interface RepoBrainStats {
  files: number
  symbols: number
  edges: number
  indexed: boolean
}

function toRepoPath(value: string): string {
  return value.replaceAll('\\', '/')
}

function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9_.$@/-]+/)
    .map(part => part.trim())
    .filter(part => part.length >= 2)
}

function uniqueBounded(values: Iterable<string>, max: number): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    if (value.length === 0) continue
    seen.add(value)
    if (seen.size >= max) break
  }
  return [...seen]
}

/** Cheap symbol extraction intended for routing/retrieval, not compilation. */
export function extractSymbols(text: string, extension: string): string[] {
  const found: string[] = []
  const patterns: RegExp[] = extension === '.py'
    ? [/(?:^|\n)\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/g, /(?:^|\n)\s*class\s+([A-Za-z_][\w]*)/g]
    : extension === '.md' || extension === '.mdx'
      ? [/^#{1,6}\s+(.+)$/gm]
      : [
          /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
          /\b(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g,
          /\b(?:export\s+)?(?:interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/g,
          /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
        ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const symbol = match[1]?.trim()
      if (symbol !== undefined && symbol.length > 0) found.push(symbol)
    }
  }
  return uniqueBounded(found, 512)
}

/** Relative JS/TS import specs only; package imports are not repository edges. */
export function extractRelativeImportSpecs(text: string): string[] {
  const specs: string[] = []
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](\.[^'"]+)['"]/g,
    /\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1] !== undefined) specs.push(match[1])
    }
  }
  return uniqueBounded(specs, 512)
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`PHOENIX Repo Brain ${name} must be a positive safe integer`)
}

function insideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function queryTerms(query: string): string[] {
  return uniqueBounded(words(query), 64)
}

/**
 * Incremental repository index. Refresh traverses metadata every time but only
 * rereads a file when mtime or size changed; deleted files disappear atomically.
 */
export class RepoBrainIndex {
  private entries = new Map<string, RepoEntry>()
  private reverseImports = new Map<string, Set<string>>()
  private indexed = false

  constructor(private readonly config: ResolvedRepoBrainConfig) {}

  async refresh(): Promise<RepoBrainRefreshSummary> {
    const next = new Map<string, RepoEntry>()
    let reread = 0
    let reused = 0
    let truncated = false

    const paths = await this.walk()
    if (paths.length >= this.config.maxFiles) truncated = true

    for (const absolute of paths) {
      const info = await stat(absolute)
      const path = toRepoPath(relative(this.config.root, absolute))
      const previous = this.entries.get(path)
      if (previous !== undefined && previous.mtimeMs === info.mtimeMs && previous.size === info.size) {
        next.set(path, previous)
        reused += 1
        continue
      }
      const bytesToRead = Math.min(info.size, this.config.maxFileBytes)
      const file = await open(absolute, 'r')
      let text: string
      try {
        const buffer = Buffer.alloc(bytesToRead)
        const { bytesRead } = await file.read(buffer, 0, bytesToRead, 0)
        text = buffer.subarray(0, bytesRead).toString('utf8')
      } finally {
        await file.close()
      }
      const extension = extname(path).toLowerCase()
      const symbols = extractSymbols(text, extension)
      const termSource = [path, ...symbols, ...words(text)]
      const terms = uniqueBounded(termSource.flatMap(words), this.config.maxTermsPerFile)
      next.set(path, {
        path,
        mtimeMs: info.mtimeMs,
        size: info.size,
        symbols,
        terms,
        importSpecs: extractRelativeImportSpecs(text),
        imports: [],
      })
      reread += 1
    }

    this.resolveImports(next)
    const removed = [...this.entries.keys()].filter(path => !next.has(path)).length
    this.entries = next
    this.rebuildReverseImports()
    this.indexed = true
    return { files: next.size, reread, reused, removed, truncated }
  }

  private async walk(): Promise<string[]> {
    const found: string[] = []
    const visit = async (directory: string): Promise<void> => {
      if (found.length >= this.config.maxFiles) return
      const entries = await readdir(directory, { withFileTypes: true })
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (found.length >= this.config.maxFiles) return
        if (entry.isSymbolicLink()) continue
        const absolute = resolve(directory, entry.name)
        if (!insideRoot(this.config.root, absolute)) continue
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue
          await visit(absolute)
          continue
        }
        if (!entry.isFile()) continue
        const extension = extname(entry.name).toLowerCase()
        if (!SOURCE_EXTENSIONS.has(extension)) continue
        found.push(absolute)
      }
    }
    await visit(this.config.root)
    return found
  }

  private resolveImports(entries: Map<string, RepoEntry>): void {
    const available = new Set(entries.keys())
    for (const entry of entries.values()) {
      const importerDir = dirname(resolve(this.config.root, entry.path))
      const resolvedImports: string[] = []
      for (const spec of entry.importSpecs) {
        const base = resolve(importerDir, spec)
        if (!insideRoot(this.config.root, base)) continue
        const candidates: string[] = [base]
        const declaredExtension = extname(base).toLowerCase()
        if (['.js', '.jsx', '.mjs', '.cjs'].includes(declaredExtension)) {
          const stem = base.slice(0, -declaredExtension.length)
          for (const extension of ['.ts', '.tsx', '.mts', '.cts']) candidates.push(`${stem}${extension}`)
        }
        for (const extension of IMPORTABLE_EXTENSIONS) {
          candidates.push(`${base}${extension}`)
          candidates.push(resolve(base, `index${extension}`))
        }
        for (const candidate of candidates) {
          const rel = toRepoPath(relative(this.config.root, candidate))
          if (!available.has(rel)) continue
          resolvedImports.push(rel)
          break
        }
      }
      entry.imports = uniqueBounded(resolvedImports, 512)
    }
  }

  private rebuildReverseImports(): void {
    const reverse = new Map<string, Set<string>>()
    for (const entry of this.entries.values()) {
      for (const imported of entry.imports) {
        const dependents = reverse.get(imported) ?? new Set<string>()
        dependents.add(entry.path)
        reverse.set(imported, dependents)
      }
    }
    this.reverseImports = reverse
  }

  private async ensureIndexed(): Promise<void> {
    if (!this.indexed) await this.refresh()
  }

  async search(query: string, limit = this.config.defaultLimit): Promise<RepoBrainSearchHit[]> {
    await this.ensureIndexed()
    const terms = queryTerms(query)
    if (terms.length === 0) return []
    const safeLimit = Math.min(Math.max(1, limit), MAX_TOOL_LIMIT)
    const scored: RepoBrainSearchHit[] = []
    for (const entry of this.entries.values()) {
      const pathLower = entry.path.toLowerCase()
      const symbolLower = entry.symbols.map(symbol => symbol.toLowerCase())
      const termSet = new Set(entry.terms)
      let score = 0
      for (const term of terms) {
        if (pathLower === term) score += 20
        else if (pathLower.includes(term)) score += 8
        if (symbolLower.includes(term)) score += 14
        else if (symbolLower.some(symbol => symbol.includes(term))) score += 7
        if (termSet.has(term)) score += 2
      }
      if (score > 0) scored.push({ path: entry.path, score, symbols: entry.symbols.slice(0, 12) })
    }
    return scored
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, safeLimit)
  }

  async impact(path: string, depth = 2, limit = MAX_TOOL_LIMIT): Promise<RepoBrainImpactHit[]> {
    await this.ensureIndexed()
    const absolute = resolve(this.config.root, path)
    if (!insideRoot(this.config.root, absolute)) throw new Error('PHOENIX Repo Brain impact path escapes repository root')
    const target = toRepoPath(relative(this.config.root, absolute))
    if (!this.entries.has(target)) throw new Error(`PHOENIX Repo Brain does not index "${path}"`)
    const safeDepth = Math.min(Math.max(1, depth), MAX_IMPACT_DEPTH)
    const safeLimit = Math.min(Math.max(1, limit), MAX_TOOL_LIMIT)
    const queue: { path: string; depth: number }[] = [{ path: target, depth: 0 }]
    const seen = new Set([target])
    const result: RepoBrainImpactHit[] = []
    while (queue.length > 0 && result.length < safeLimit) {
      const current = queue.shift()
      if (current === undefined || current.depth >= safeDepth) continue
      const dependents = [...(this.reverseImports.get(current.path) ?? [])].sort()
      for (const dependent of dependents) {
        if (seen.has(dependent)) continue
        seen.add(dependent)
        const next = { path: dependent, depth: current.depth + 1 }
        result.push(next)
        queue.push(next)
        if (result.length >= safeLimit) break
      }
    }
    return result
  }

  stats(): RepoBrainStats {
    let symbols = 0
    let edges = 0
    for (const entry of this.entries.values()) {
      symbols += entry.symbols.length
      edges += entry.imports.length
    }
    return { files: this.entries.size, symbols, edges, indexed: this.indexed }
  }
}

function formatSearch(hits: readonly RepoBrainSearchHit[]): string {
  if (hits.length === 0) return 'Repo Brain found no structural/lexical matches.'
  return hits.map(hit => `${hit.path} [score=${hit.score}]${hit.symbols.length > 0 ? ` symbols: ${hit.symbols.join(', ')}` : ''}`).join('\n')
}

function formatImpact(path: string, hits: readonly RepoBrainImpactHit[]): string {
  if (hits.length === 0) return `Repo Brain found no indexed reverse dependents of ${path}.`
  return [`Reverse impact for ${path}:`, ...hits.map(hit => `${'  '.repeat(Math.max(0, hit.depth - 1))}- ${hit.path} (depth ${hit.depth})`)].join('\n')
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    phoenixRepoBrain: PhoenixRepoBrain
  }
}

/** Cordis service and model-facing tool over the zero-token index. */
export default class PhoenixRepoBrain extends Service {
  static inject = ['tools', 'systemPrompt']

  static Config: z<RepoBrainConfig> = z.object({
    root: z.string(),
    maxFiles: z.number().default(DEFAULT_MAX_FILES),
    maxFileBytes: z.number().default(DEFAULT_MAX_FILE_BYTES),
    maxTermsPerFile: z.number().default(DEFAULT_MAX_TERMS_PER_FILE),
    defaultLimit: z.number().default(DEFAULT_LIMIT),
  }) as z<RepoBrainConfig>

  readonly index: RepoBrainIndex

  constructor(ctx: Context, config: RepoBrainConfig = {}) {
    super(ctx, 'phoenixRepoBrain')
    const root = resolve(config.root ?? process.cwd())
    const resolved: ResolvedRepoBrainConfig = {
      root,
      maxFiles: config.maxFiles ?? DEFAULT_MAX_FILES,
      maxFileBytes: config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
      maxTermsPerFile: config.maxTermsPerFile ?? DEFAULT_MAX_TERMS_PER_FILE,
      defaultLimit: config.defaultLimit ?? DEFAULT_LIMIT,
    }
    assertPositiveInteger('maxFiles', resolved.maxFiles)
    assertPositiveInteger('maxFileBytes', resolved.maxFileBytes)
    assertPositiveInteger('maxTermsPerFile', resolved.maxTermsPerFile)
    assertPositiveInteger('defaultLimit', resolved.defaultLimit)
    if (resolved.defaultLimit > MAX_TOOL_LIMIT) throw new Error(`PHOENIX Repo Brain defaultLimit must be <= ${MAX_TOOL_LIMIT}`)
    this.index = new RepoBrainIndex(resolved)

    ctx.systemPrompt.section({
      name: 'phoenix:repo-brain',
      order: 102,
      text: 'Use repo_brain before broad repository grep/read sweeps when locating architecture, symbols, or reverse dependency impact. It is a deterministic local index and uses no model calls.',
    })

    const tool = defineTool({
      name: 'repo_brain',
      description: 'Query PHOENIX zero-token repository intelligence. search ranks relevant files/symbols; impact follows reverse relative-import dependencies; refresh incrementally rereads changed files only; stats reports index size.',
      parameters: {
        action: { type: 'string', required: true, enum: ['search', 'impact', 'refresh', 'stats'] },
        query: { type: 'string', description: 'Search query when action=search.' },
        path: { type: 'string', description: 'Repository-relative indexed file when action=impact.' },
        limit: { type: 'number', description: `Maximum returned matches, 1-${MAX_TOOL_LIMIT}.` },
        depth: { type: 'number', description: `Reverse dependency depth for impact, 1-${MAX_IMPACT_DEPTH}.` },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute: async (args) => {
        const action = args.action
        if (action === 'search') {
          const query = typeof args.query === 'string' ? args.query.trim() : ''
          if (query.length === 0) throw new Error('repo_brain search requires query')
          const limit = typeof args.limit === 'number' ? Math.trunc(args.limit) : resolved.defaultLimit
          return { text: formatSearch(await this.index.search(query, limit)) }
        }
        if (action === 'impact') {
          const path = typeof args.path === 'string' ? args.path.trim() : ''
          if (path.length === 0) throw new Error('repo_brain impact requires path')
          const depth = typeof args.depth === 'number' ? Math.trunc(args.depth) : 2
          const limit = typeof args.limit === 'number' ? Math.trunc(args.limit) : resolved.defaultLimit
          return { text: formatImpact(path, await this.index.impact(path, depth, limit)) }
        }
        if (action === 'refresh') {
          const summary = await this.index.refresh()
          return { text: `Repo Brain refreshed ${summary.files} files: reread=${summary.reread}, reused=${summary.reused}, removed=${summary.removed}, truncated=${String(summary.truncated)}.` }
        }
        if (action === 'stats') {
          const stats = this.index.stats()
          return { text: `Repo Brain stats: files=${stats.files}, symbols=${stats.symbols}, edges=${stats.edges}, indexed=${String(stats.indexed)}.` }
        }
        throw new Error(`repo_brain unknown action "${String(action)}"`)
      },
    })
    ctx.tools.register(tool)
  }
}
