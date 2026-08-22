/**
 * One public client build profile plus the sidecar record that proves which
 * values produced a staged/release-shaped client tree.
 *
 * Public client values are deliberately a tiny `DSH_CLIENT_*` namespace. They
 * are safe to inline into browser JavaScript. Secrets use other namespaces and
 * must never cross this boundary. Internal build selection is
 * `DSH_BUILD_CLIENT_PROFILE`: it chooses a named public environment but is not
 * itself inlined.
 * @module scripts/client-build-environment
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_PREFIX = 'DSH_CLIENT_'
const BUILD_PROFILE_ENV = 'DSH_BUILD_CLIENT_PROFILE'
const RECORD_NAME = 'client-build.json'
const RECORD_VERSION = 1
const COMMIT_HASH_LENGTH = 7
const CLIENT_ARTIFACT_ROOTS = [
  'apps/web/dist',
  'packages/client',
] as const

/** Client environment that uniquely identifies this downstream's official artifact. */
export const OFFICIAL_CLIENT_BUILD_ENVIRONMENT = Object.freeze({
  DSH_CLIENT_BUILD_PROFILE: 'official',
  DSH_CLIENT_TITLE: 'PHOENIX',
})

/** Public client build environment plus its required commit-bound field. */
export type OfficialClientBuildEnvironment = typeof OFFICIAL_CLIENT_BUILD_ENVIRONMENT & {
  DSH_CLIENT_COMMIT_HASH: string
}

/** Serializable sidecar that binds one public environment to a client artifact set. */
export interface ClientBuildRecord {
  readonly version: typeof RECORD_VERSION
  readonly environment: Readonly<Record<string, string>>
  readonly files: Readonly<Record<string, string>>
}

/** Return only browser-safe `DSH_CLIENT_*` values from an environment object. */
export function publicClientEnvironment(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env)
      .filter((entry): entry is [string, string] => entry[0].startsWith(PUBLIC_PREFIX) && entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

/**
 * Resolve the public client environment for a named build profile. With no
 * explicit profile, the caller's public `DSH_CLIENT_*` values pass through.
 * @param env - Parent process environment.
 * @param explicitProfile - Optional profile override.
 * @returns the exact public environment for the client build.
 */
export function resolveClientBuildEnvironment(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
  explicitProfile: string | undefined = env[BUILD_PROFILE_ENV],
): Record<string, string> {
  if (explicitProfile === undefined || explicitProfile === '') return publicClientEnvironment(env)
  if (explicitProfile !== 'official') throw new Error(`unknown client build profile: ${explicitProfile}`)

  const commitHash = env.DSH_CLIENT_COMMIT_HASH
  if (commitHash === undefined || commitHash === '') {
    throw new Error('official client build requires DSH_CLIENT_COMMIT_HASH')
  }
  return {
    ...OFFICIAL_CLIENT_BUILD_ENVIRONMENT,
    DSH_CLIENT_COMMIT_HASH: normalizeCommitHash(commitHash),
  }
}

/**
 * Construct a child process environment whose public client namespace exactly
 * equals the supplied build environment. Non-client values pass through.
 */
export function clientBuildProcessEnvironment(
  parent: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
  publicEnvironment: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(parent)) {
    if (!key.startsWith(PUBLIC_PREFIX) && value !== undefined) next[key] = value
  }
  for (const [key, value] of Object.entries(publicEnvironment)) next[key] = value
  return next
}

/** Assert that the visible public namespace exactly matches an expected artifact profile. */
export function assertClientBuildEnvironment(
  actualEnvironment: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
  expectedEnvironment: Readonly<Record<string, string>>,
): void {
  const actual = publicClientEnvironment(actualEnvironment)
  const expected = Object.fromEntries(Object.entries(expectedEnvironment).sort(([a], [b]) => a.localeCompare(b)))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `client build environment mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

/** Convert public client values into Vite/tsdown define entries without leaking `process.env`. */
export function clientBuildEnvironmentDefines(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const values = publicClientEnvironment(env)
  return {
    'process.env': '{}',
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)])),
  }
}

/** Resolve a repository commit hash from an explicit public value or git. */
export function repositoryCommitHash(
  root = ROOT,
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
): string {
  const explicit = env.DSH_CLIENT_COMMIT_HASH
  if (explicit !== undefined && explicit !== '') return normalizeCommitHash(explicit)
  const result = spawnSync('git', ['rev-parse', '--short', String(COMMIT_HASH_LENGTH), 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`unable to resolve repository commit hash: ${(result.stderr || result.stdout).trim()}`)
  }
  return normalizeCommitHash(result.stdout.trim())
}

/** Write the client build environment + artifact digests into a release-shaped root. */
export function writeClientBuildRecord(
  root: string,
  environment: Readonly<Record<string, string>>,
): ClientBuildRecord {
  const record: ClientBuildRecord = {
    version: RECORD_VERSION,
    environment: Object.freeze({ ...environment }),
    files: Object.freeze(clientArtifactDigests(root)),
  }
  const path = resolve(root, RECORD_NAME)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`)
  return record
}

/** Read and validate a release-shaped client build record, including all artifact hashes. */
export function readClientBuildRecord(
  root: string,
  expectedEnvironment?: Readonly<Record<string, string>>,
): ClientBuildRecord {
  const path = resolve(root, RECORD_NAME)
  if (!existsSync(path)) throw new Error(`client build record missing: ${path}`)
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`invalid client build record: ${path}`)
  }
  const version = Reflect.get(raw, 'version')
  const environment = Reflect.get(raw, 'environment')
  const files = Reflect.get(raw, 'files')
  if (version !== RECORD_VERSION || !isStringRecord(environment) || !isStringRecord(files)) {
    throw new Error(`invalid client build record shape: ${path}`)
  }
  if (expectedEnvironment !== undefined) {
    const expected = sortedRecord(expectedEnvironment)
    if (JSON.stringify(sortedRecord(environment)) !== JSON.stringify(expected)) {
      throw new Error(
        `client build record environment mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(environment)}`,
      )
    }
  }
  const currentFiles = clientArtifactDigests(root)
  if (JSON.stringify(sortedRecord(files)) !== JSON.stringify(sortedRecord(currentFiles))) {
    throw new Error(`client build record artifacts differ from staged client tree: ${path}`)
  }
  return {
    version: RECORD_VERSION,
    environment: Object.freeze({ ...environment }),
    files: Object.freeze({ ...files }),
  }
}

function normalizeCommitHash(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[0-9a-f]{7,40}$/.test(normalized)) throw new Error(`invalid client commit hash: ${JSON.stringify(value)}`)
  return normalized.slice(0, COMMIT_HASH_LENGTH)
}

function clientArtifactDigests(root: string): Record<string, string> {
  const files: string[] = []
  for (const item of CLIENT_ARTIFACT_ROOTS) collectFiles(resolve(root, item), files)
  return Object.fromEntries(
    files.sort().map(path => [relative(root, path).replaceAll('\\', '/'), sha256(path)]),
  )
}

function collectFiles(path: string, files: string[]): void {
  if (!existsSync(path)) return
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name)
    if (entry.isDirectory()) collectFiles(child, files)
    else if (entry.isFile()) files.push(child)
  }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(value).every(([key, entry]) => key.length > 0 && typeof entry === 'string')
}

function sortedRecord(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)))
}
