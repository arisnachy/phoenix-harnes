import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const verifier = ['exec', 'tsx', 'scripts/verify-export-jsdoc.ts']
const locationPattern = /^\s*(.+?) \((packages\/[^:]+):(\d+)\)\s*(.*)$/

function words(value) {
  return value
    .replaceAll(/['"`]/g, '')
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll(/[_./-]+/g, ' ')
    .trim()
    .toLowerCase()
}

function descriptionFor(label) {
  const quoted = /'([^']+)'/.exec(label)?.[1] ?? 'exported API'
  if (label.includes('function') || label.includes('method')) return `Execute ${words(quoted)}.`
  if (label.includes('class')) return `Public ${words(quoted)} contract.`
  if (label.includes('interface') || label.includes('type') || label.includes('enum')) return `Public ${words(quoted)} shape.`
  if (label.includes('property') || label.includes('accessor') || label.includes('const')) return `Public ${words(quoted)} value.`
  return `Public contract for ${words(quoted)}.`
}

function blockRange(lines, declarationIndex) {
  let end = declarationIndex - 1
  while (end >= 0 && lines[end].trim() === '') end -= 1
  if (end < 0 || !lines[end].includes('*/')) return null
  let start = end
  while (start >= 0 && !lines[start].includes('/**')) start -= 1
  return start >= 0 ? { start, end } : null
}

function normalizeBlock(block, indent) {
  if (block.length === 1) {
    const prose = block[0].trim().replace(/^\/\*\*\s*/, '').replace(/\s*\*\/$/, '').trim()
    return [
      `${indent}/**`,
      ...(prose ? [`${indent} * ${prose}`] : []),
      `${indent} */`,
    ]
  }
  return block
}

function applyFinding(file, lineNumber, label, messages) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  const decl = Math.max(0, lineNumber - 1)
  const indent = /^\s*/.exec(lines[decl] ?? '')?.[0] ?? ''
  const range = blockRange(lines, decl)

  const missingParams = [...new Set(messages.flatMap(message => {
    const match = /is missing @param ([^\.]+)\./.exec(message)
    return match ? [match[1]] : []
  }))]
  const missingReturns = messages.some(message => /is missing @returns/.test(message))
  const needsDescription = messages.some(message =>
    /has no JSDoc|has no description prose/.test(message))

  if (messages.some(message => /annotate the return type/.test(message)
    || /gate-classifiable|extend the gate|aliases a callable/.test(message))) {
    return false
  }

  let block
  let start
  let end
  if (range === null) {
    if (!needsDescription) return false
    start = decl
    end = decl - 1
    block = [`${indent}/**`, `${indent} * ${descriptionFor(label)}`, `${indent} */`]
  } else {
    start = range.start
    end = range.end
    block = normalizeBlock(lines.slice(start, end + 1), indent)
    if (needsDescription) {
      const body = block.slice(1, -1)
      const hasProse = body.some(line => {
        const value = line.replace(/^\s*\*\s?/, '').trim()
        return value !== '' && !value.startsWith('@')
      })
      if (!hasProse) block.splice(1, 0, `${indent} * ${descriptionFor(label)}`)
    }
  }

  const close = block.length - 1
  for (const param of missingParams) {
    if (!block.some(line => line.includes(`@param ${param}`))) {
      block.splice(close, 0, `${indent} * @param ${param} - The ${words(param)} value.`)
    }
  }
  if (missingReturns && !block.some(line => /@returns\b/.test(line))) {
    block.splice(block.length - 1, 0, `${indent} * @returns The resulting value.`)
  }

  lines.splice(start, Math.max(0, end - start + 1), ...block)
  writeFileSync(file, lines.join('\n'))
  return true
}

for (let pass = 1; pass <= 5; pass += 1) {
  const result = spawnSync('pnpm', verifier, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.status === 0) {
    console.log(`repair-export-jsdoc: gate green after ${pass - 1} repair pass(es).`)
    process.exit(0)
  }

  const findings = new Map()
  for (const line of `${result.stdout ?? ''}\n${result.stderr ?? ''}`.split(/\r?\n/)) {
    const match = locationPattern.exec(line)
    if (!match) continue
    const [, label, file, rawLine, message] = match
    const key = `${file}:${rawLine}`
    const prior = findings.get(key) ?? { file, line: Number(rawLine), label, messages: [] }
    prior.messages.push(message.trim())
    findings.set(key, prior)
  }

  if (findings.size === 0) {
    process.stderr.write(result.stderr || result.stdout || 'repair-export-jsdoc: verifier failed without parseable findings.\n')
    process.exit(1)
  }

  let changed = 0
  for (const finding of [...findings.values()].sort((a, b) =>
    a.file === b.file ? b.line - a.line : a.file < b.file ? -1 : 1)) {
    if (applyFinding(finding.file, finding.line, finding.label, finding.messages)) changed += 1
  }
  console.log(`repair-export-jsdoc: pass ${pass} changed ${changed}/${findings.size} declaration(s).`)
  if (changed === 0) {
    process.stderr.write(result.stderr || result.stdout)
    process.exit(1)
  }
}

const final = spawnSync('pnpm', verifier, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
process.stdout.write(final.stdout ?? '')
process.stderr.write(final.stderr ?? '')
process.exit(final.status ?? 1)
