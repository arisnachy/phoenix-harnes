/** Plan the package-namespace migration from the inherited DeepSeek scope to PHOENIX. */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..')
const LEGACY_SCOPE = '@deepseek-ai/'
const PHOENIX_SCOPE = '@phoenix-ai/'

interface PackageIdentity {
  readonly path: string
  readonly current: string
  readonly target: string
}

interface ScopeMigrationReport {
  readonly schema: 1
  readonly legacyScope: typeof LEGACY_SCOPE
  readonly targetScope: typeof PHOENIX_SCOPE
  readonly packages: readonly PackageIdentity[]
  readonly problems: readonly string[]
}

function trackedPackageJsonFiles(): string[] {
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

function packageName(path: string): string | undefined {
  const text = readFileSync(resolve(root, path), 'utf8')
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const name = (parsed as { name?: unknown }).name
  return typeof name === 'string' ? name : undefined
}

function collectReport(): ScopeMigrationReport {
  const names = new Map<string, string>()
  const legacy: PackageIdentity[] = []
  const problems: string[] = []

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

  const targets = new Map<string, PackageIdentity>()
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

function main(args: readonly string[]): void {
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
