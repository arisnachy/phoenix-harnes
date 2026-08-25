/** Run repository builds and bind client artifacts to their public environment. */

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  CLIENT_BUILD_RECORD_PATH,
  clientBuildProcessEnvironment,
  repositoryCommitHash,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'

/** Build scope selected by callers such as the stable updater. */
type BuildScope = 'full' | 'client'

/** Resolve pnpm even when the stable updater launches this script outside a pnpm lifecycle. */
function buildPnpmInvocation(args: readonly string[], environment: NodeJS.ProcessEnv): { command: string; args: string[] } {
  if (environment.npm_execpath !== undefined && environment.npm_execpath !== '') {
    return pnpmInvocation(args, environment)
  }
  if (process.platform === 'win32') {
    return {
      command: environment.ComSpec ?? process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', 'corepack.cmd', 'pnpm', ...args],
    }
  }
  return { command: 'corepack', args: ['pnpm', ...args] }
}

/** Run one package script through the active pnpm lifecycle or the updater-safe Corepack fallback. */
function runScript(script: string, environment: NodeJS.ProcessEnv): void {
  const invocation = buildPnpmInvocation(['run', script], environment)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: resolve(import.meta.dirname, '..'),
    env: environment,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build: ${script} exited with ${String(result.status ?? result.signal)}`)
  }
}

/** Parse and validate the optional updater-facing build scope. */
function buildScope(value: string | undefined): BuildScope {
  if (value === undefined || value === 'full') return 'full'
  if (value === 'client') return 'client'
  throw new Error(`build: --scope must be full or client; got ${JSON.stringify(value)}`)
}

/** Run the full build or the safe client-only incremental build. */
function main(): void {
  const { values } = parseArgs({
    options: {
      profile: { type: 'string' },
      scope: { type: 'string' },
    },
    allowPositionals: false,
  })
  const root = resolve(import.meta.dirname, '..')
  const parentEnvironment = {
    ...process.env,
    DSH_CLIENT_COMMIT_HASH: repositoryCommitHash(root, process.env),
  }
  const clientEnvironment = resolveClientBuildEnvironment(parentEnvironment, values.profile)
  const buildEnvironment = clientBuildProcessEnvironment(parentEnvironment, clientEnvironment)
  const scope = buildScope(values.scope)

  rmSync(resolve(root, CLIENT_BUILD_RECORD_PATH), { force: true })
  if (scope === 'full') {
    runScript('build:lib', buildEnvironment)
  } else {
    runScript('build:lib:client', buildEnvironment)
  }
  runScript('build:web', buildEnvironment)
  const record = writeClientBuildRecord(root, clientEnvironment)
  console.log(
    `build: ${scope} recorded ${String(record.artifacts.fileCount)} client artifact(s) with ${String(Object.keys(record.environment).length)} public value(s)`,
  )
}

if (import.meta.main) main()
