#!/usr/bin/env node
/**
 * Boot-critical PHOENIX configuration guard.
 *
 * The live Host may be edited by an agent, but a restart must never make the
 * edited configuration the only recoverable copy. This module keeps a local,
 * user-owned last-known-good snapshot of non-secret boot configuration and
 * provides a boot-free preflight that parses the exact Web profile before the
 * supervisor stops the live Host.
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const SNAPSHOT_SCHEMA = 1
const RESTART_SCHEMA = 1
const CONFIG_FILENAMES = new Set(['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml'])

export function resolvePhoenixHome(env = process.env) {
  const configured = env.DSH_HOME?.trim()
  return configured !== undefined && configured.length > 0
    ? resolve(configured)
    : join(homedir(), '.dsh')
}

export function phoenixRuntimeStateDir(env = process.env) {
  return join(resolvePhoenixHome(env), '.phoenix-runtime-guard')
}

export function runtimeRestartRequestPath(env = process.env) {
  return join(phoenixRuntimeStateDir(env), 'restart-request.json')
}

export function runtimeRestartResultPath(env = process.env) {
  return join(phoenixRuntimeStateDir(env), 'restart-result.json')
}

function knownGoodPath(env = process.env) {
  return join(phoenixRuntimeStateDir(env), 'known-good-config.json')
}

export function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(value, undefined, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

function normalizedRelativePath(home, path) {
  return relative(home, path).split(sep).join('/')
}

function collectProfileConfig(home) {
  const profiles = join(home, 'profiles')
  if (!existsSync(profiles)) return []
  const result = []
  for (const entry of readdirSync(profiles, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const dir = join(profiles, entry.name)
    for (const filename of CONFIG_FILENAMES) {
      const path = join(dir, filename)
      if (existsSync(path)) result.push(path)
    }
  }
  return result
}

export function collectBootCriticalConfiguration(env = process.env) {
  const home = resolvePhoenixHome(env)
  const paths = collectProfileConfig(home)
  const codexPatch = join(home, 'codex', 'enabled.patch.yml')
  if (existsSync(codexPatch)) paths.push(codexPatch)
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right))
}

function snapshotEntries(env = process.env) {
  const home = resolvePhoenixHome(env)
  return collectBootCriticalConfiguration(env).map(path => ({
    path: normalizedRelativePath(home, path),
    content: readFileSync(path).toString('base64'),
  }))
}

function fingerprintEntries(entries) {
  const hash = createHash('sha256')
  for (const entry of entries) {
    hash.update(entry.path)
    hash.update('\0')
    hash.update(entry.content)
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

export function currentConfigurationFingerprint(env = process.env) {
  return fingerprintEntries(snapshotEntries(env))
}

function readKnownGood(env = process.env) {
  const path = knownGoodPath(env)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schema !== SNAPSHOT_SCHEMA || typeof value.fingerprint !== 'string' || !Array.isArray(value.files)) {
      return undefined
    }
    if (!value.files.every(file => typeof file?.path === 'string' && typeof file?.content === 'string')) return undefined
    return value
  } catch {
    return undefined
  }
}

export function hasKnownGoodConfiguration(env = process.env) {
  return readKnownGood(env) !== undefined
}

export function configurationDiffersFromKnownGood(env = process.env) {
  const known = readKnownGood(env)
  return known !== undefined && known.fingerprint !== currentConfigurationFingerprint(env)
}

export function captureKnownGoodConfiguration(env = process.env) {
  const files = snapshotEntries(env)
  const snapshot = {
    schema: SNAPSHOT_SCHEMA,
    createdAt: new Date().toISOString(),
    fingerprint: fingerprintEntries(files),
    files,
  }
  atomicWriteJson(knownGoodPath(env), snapshot)
  return snapshot.fingerprint
}

function safeSnapshotPath(home, relativePath) {
  const resolved = resolve(home, ...relativePath.split('/'))
  const prefix = home.endsWith(sep) ? home : `${home}${sep}`
  if (resolved !== home && !resolved.startsWith(prefix)) {
    throw new Error(`unsafe configuration snapshot path: ${relativePath}`)
  }
  return resolved
}

export function restoreKnownGoodConfiguration(env = process.env) {
  const known = readKnownGood(env)
  if (known === undefined) return false
  const home = resolvePhoenixHome(env)
  const wanted = new Set(known.files.map(file => file.path))
  for (const current of collectBootCriticalConfiguration(env)) {
    const key = normalizedRelativePath(home, current)
    if (!wanted.has(key)) {
      try { unlinkSync(current) } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
  }
  for (const file of known.files) {
    const destination = safeSnapshotPath(home, file.path)
    mkdirSync(dirname(destination), { recursive: true })
    const temporary = `${destination}.${process.pid}.restore.tmp`
    writeFileSync(temporary, Buffer.from(file.content, 'base64'), { mode: 0o600 })
    renameSync(temporary, destination)
  }
  return currentConfigurationFingerprint(env) === known.fingerprint
}

function compactDiagnostic(result) {
  const text = [result.stderr, result.stdout]
    .filter(value => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .trim()
  if (text.length === 0) return `configuration preflight exited with code ${String(result.status ?? 1)}`
  const lines = text.split(/\r?\n/u)
  return lines.slice(Math.max(0, lines.length - 24)).join('\n').slice(-6000)
}

export function preflightPhoenixConfiguration(root, env = process.env) {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx/esm',
    'apps/cli/src/bin.ts',
    'web',
    '--dump-config',
  ], {
    cwd: root,
    env: {
      ...env,
      PHOENIX_UPDATE_SUPERVISED: '1',
      PHOENIX_AUTO_UPDATE: '0',
      PHOENIX_UPDATE_MODE: 'off',
      DSH_TELEMETRY_DISABLED: '1',
    },
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 45_000,
  })
  if (result.error !== undefined) {
    return { ok: false, status: 1, summary: `configuration preflight failed to launch: ${result.error.message}` }
  }
  if (result.status !== 0) {
    return { ok: false, status: result.status ?? 1, summary: compactDiagnostic(result) }
  }
  return {
    ok: true,
    status: 0,
    summary: 'Web profile parsed and composed successfully without stopping the live Host.',
  }
}

export function clearRuntimeRestartRequest(env = process.env) {
  try {
    unlinkSync(runtimeRestartRequestPath(env))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

export function clearRuntimeRestartResult(env = process.env) {
  try {
    unlinkSync(runtimeRestartResultPath(env))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

export function resetPhoenixRuntimeGuardForTests(env = process.env) {
  rmSync(phoenixRuntimeStateDir(env), { recursive: true, force: true })
}
