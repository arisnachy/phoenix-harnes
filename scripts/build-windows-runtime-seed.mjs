#!/usr/bin/env node
/**
 * Build the Windows desktop runtime seed.
 *
 * The installed Phoenix desktop must never clone, install dependencies, or
 * compile TypeScript on its first-launch critical path. CI builds the workspace,
 * deploys the CLI dependency closure into runtime-app/, and snapshots the
 * tracked source + Git metadata that the existing safe stable updater still
 * needs for background updates and rollback.
 */

import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const seedRoot = resolve(root, 'dist', 'windows-runtime-seed')
const runtimeApp = join(seedRoot, 'runtime-app')
const markerName = '.phoenix-managed-install'

function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.stdio ?? 'inherit',
    timeout: options.timeout,
    windowsHide: true,
  })
  if (result.error !== undefined) throw result.error
  if ((result.status ?? 1) !== 0) {
    const detail = [result.stdout, result.stderr]
      .filter(value => typeof value === 'string' && value.trim() !== '')
      .join('\n')
      .trim()
    throw new Error(`${bin} ${args.join(' ')} exited with ${String(result.status)}${detail === '' ? '' : `: ${detail}`}`)
  }
  return result
}

function copyTrackedSource() {
  const listed = run('git', ['ls-files', '-z'], { stdio: ['ignore', 'pipe', 'pipe'] }).stdout ?? ''
  for (const relative of listed.split('\0').filter(Boolean)) {
    const source = join(root, relative)
    const destination = join(seedRoot, relative)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(source, destination, { recursive: true, dereference: true })
  }

  const gitMetadata = join(root, '.git')
  if (!existsSync(gitMetadata) || !lstatSync(gitMetadata).isDirectory()) {
    throw new Error('Windows runtime seed requires a normal Git checkout with a .git directory')
  }
  cpSync(gitMetadata, join(seedRoot, '.git'), { recursive: true, dereference: true })
}

function findLink(directory) {
  if (!existsSync(directory)) return undefined
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = lstatSync(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = findLink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

function materializeRuntimeLinks() {
  const nodeModules = join(runtimeApp, 'node_modules')
  let link = findLink(nodeModules)
  while (link !== undefined) {
    const segments = link.slice(nodeModules.length + 1).split(sep)
    const binIndex = segments.lastIndexOf('.bin')
    if (binIndex >= 0) {
      rmSync(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
      link = findLink(nodeModules)
      continue
    }

    const source = realpathSync(link)
    const nestedNodeModules = join(source, 'node_modules')
    rmSync(link, { recursive: true, force: true })
    cpSync(source, link, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
    link = findLink(nodeModules)
  }
}

function deployRuntimeApp() {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  run(pnpm, [
    '--filter', '@phoenix-ai/dsh',
    'deploy',
    '--legacy',
    '--config.node-linker=hoisted',
    '--config.link-workspace-packages=true',
    runtimeApp,
  ])
  materializeRuntimeLinks()

  const entry = join(runtimeApp, 'lib', 'bin.js')
  if (!existsSync(entry)) throw new Error(`deployed Phoenix CLI entrypoint is missing: ${entry}`)

  run(process.execPath, [entry, '--version'], { cwd: runtimeApp })
  run(process.execPath, [entry, 'web', '--dump-config'], {
    cwd: runtimeApp,
    env: {
      ...process.env,
      PHOENIX_AUTO_UPDATE: '0',
      PHOENIX_UPDATE_MODE: 'off',
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    },
    timeout: 60_000,
  })
}

function preserveUpdaterCleanliness() {
  const exclude = join(seedRoot, '.git', 'info', 'exclude')
  mkdirSync(dirname(exclude), { recursive: true })
  appendFileSync(
    exclude,
    [
      '',
      '# Phoenix desktop production runtime seed',
      '/runtime-app/',
      `/${markerName}`,
      '',
    ].join('\n'),
    'utf8',
  )

  const commit = run('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'pipe'] }).stdout.trim()
  writeFileSync(join(seedRoot, markerName), [
    'schema=1',
    'state=ready',
    'channel=stable',
    `commit=${commit}`,
    `installedAt=${new Date().toISOString()}`,
    'source=windows-ci-runtime-seed',
    '',
  ].join('\n'), 'utf8')

  const status = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: seedRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).stdout.trim()
  if (status !== '') throw new Error(`runtime seed Git checkout is not clean:\n${status}`)
}

rmSync(seedRoot, { recursive: true, force: true })
mkdirSync(seedRoot, { recursive: true })
copyTrackedSource()
deployRuntimeApp()
preserveUpdaterCleanliness()

console.log(`Windows production runtime seed ready: ${seedRoot}`)
