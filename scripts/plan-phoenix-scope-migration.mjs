#!/usr/bin/env node
/** Plan the package-namespace migration from the inherited DeepSeek scope to PHOENIX. */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..')
const LEGACY_SCOPE = '@deepseek-ai/'
const PHOENIX_SCOPE = '@phoenix-ai/'

function trackedPackageJsonFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })
  return output
    .toString('utf8')
    .split('\0')
    .filter(path => path === 'package.json' || path.endsWith('/package.json'))
    .sort()
}

function packageName(path) {
  const text = readFileSync(resolve(root, path), 'utf8')
  const parsed = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const name = parsed.name
  return typeof name === 'string' ? name : undefined
}

function collectReport() {
  const names = new Map()
  const legacy = []
  const problems = []

  for (const path of trackedPackageJsonFiles()) {
    const name = packageName(path)
    if (name === undefined) continue
    const previous = names.get(name)
    if (previous !== undefined) {
      problems.push(`duplicate package name ${JSON.stringify(name)}: ${previous}, ${path}`)
      continue
    }
    names.set(name, path)
    if (!name.startsWith(LEGACY_SCOPE)) continue
    const suffix = name.slice(LEGACY_SCOPE.length)
    legacy.push({ path, current: name, target: `${PHOENIX_SCOPE}${suffix}` })
  }

  const targets = new Map()
  for (const entry of legacy) {
    const previous = targets.get(entry.target)
    if (previous !== undefined) {
      problems.push(
        `target collision ${JSON.stringify(entry.target)}: ${previous.path} (${previous.current}) and ${entry.path} (${entry.current})`,
      )
    } else {
      targets.set(entry.target, entry)
    }

    const occupied = names.get(entry.target)
    if (occupied !== undefined && occupied !== entry.path) {
      problems.push(
        `target name ${JSON.stringify(entry.target)} is already owned by ${occupied}; cannot migrate ${entry.path}`,
      )
    }
  }

  legacy.sort((left, right) => left.current.localeCompare(right.current))
  problems.sort()
  return {
    schema: 1,
    legacyScope: LEGACY_SCOPE,
    targetScope: PHOENIX_SCOPE,
    packages: legacy,
    problems,
  }
}

function main(args) {
  const { values } = parseArgs({
    args,
    options: {
      check: { type: 'boolean', default: false },
    },
    allowPositionals: false,
    strict: true,
  })
  const report = collectReport()

  if (values.check) {
    if (report.problems.length > 0) {
      process.stderr.write(`phoenix scope migration: ${String(report.problems.length)} problem(s)\n`)
      for (const problem of report.problems) process.stderr.write(`- ${problem}\n`)
      process.exitCode = 1
      return
    }
    process.stdout.write(
      `phoenix scope migration: ${String(report.packages.length)} package(s) can map ${LEGACY_SCOPE} -> ${PHOENIX_SCOPE} without identity collisions\n`,
    )
    return
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

main(process.argv.slice(2))
