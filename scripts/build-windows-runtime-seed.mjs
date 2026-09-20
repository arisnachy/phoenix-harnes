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
const sdkClosureRoot = resolve(root, 'dist', 'windows-runtime-sdk-closure')
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

function runPnpm(args) {
  if (process.platform === 'win32') {
    return run(process.env.ComSpec ?? 'cmd.exe', [
      '/d',
      '/s',
      '/c',
      'corepack.cmd',
      'pnpm',
      ...args,
    ])
  }
  return run('pnpm', args)
}

function sanitizeCopiedGitMetadata() {
  const keys = [
    'http.https://github.com/.extraheader',
    'core.sshCommand',
  ]
  for (const key of keys) {
    const result = spawnSync('git', ['config', '--local', '--unset-all', key], {
      cwd: seedRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    // git-config returns 5 when the key does not exist.
    if (result.error !== undefined) throw result.error
    if (result.status !== 0 && result.status !== 5) {
      throw new Error(`could not sanitize copied Git config key ${key}: ${result.stderr?.trim() ?? ''}`)
    }
  }

  const config = readFileSync(join(seedRoot, '.git', 'config'), 'utf8')
  if (/extraheader|authorization\s*:/iu.test(config)) {
    throw new Error('Windows runtime seed Git config still contains authentication material')
  }
}

function copyTrackedSource() {
  const gitMetadata = join(root, '.git')
  if (!existsSync(gitMetadata) || !lstatSync(gitMetadata).isDirectory()) {
    throw new Error('Windows runtime seed requires a normal Git checkout with a .git directory')
  }

  // Copy the repository database first, then let Git itself materialize the
  // worktree. Copying tracked paths with fs.cp({ dereference: true }) turns
  // tracked symlinks into regular files/directories on Windows, making the seed
  // appear dirty before it ever starts. A hard reset reproduces the exact
  // checkout semantics of the target machine and keeps the updater worktree clean.
  cpSync(gitMetadata, join(seedRoot, '.git'), { recursive: true, dereference: true })
  sanitizeCopiedGitMetadata()
  run('git', ['reset', '--hard', 'HEAD'], { cwd: seedRoot })
  run('git', ['clean', '-fdx'], { cwd: seedRoot })
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

function materializeRuntimeLinks(stagingRoot = runtimeApp) {
  const nodeModules = join(stagingRoot, 'node_modules')
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

function restoreSdkLegacyHoists() {
  const manifest = JSON.parse(readFileSync(join(sdkClosureRoot, 'package.json'), 'utf8'))
  const sourceNodeModules = resolve(root, 'python', 'sdk-runtime', 'node_modules')
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(sdkClosureRoot, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceNodeModules, dependency)
    if (!existsSync(source)) {
      throw new Error(`SDK runtime dependency ${dependency} is missing from both deploy output and ${source}`)
    }
    mkdirSync(dirname(destination), { recursive: true })
    const nestedNodeModules = join(source, 'node_modules')
    cpSync(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
  }
}

function mergeVerifiedSdkClosure() {
  rmSync(sdkClosureRoot, { recursive: true, force: true })
  runPnpm([
    '--filter', 'dsh-jsonrpc-agent-pkg',
    'deploy',
    '--legacy',
    '--prod',
    '--config.node-linker=hoisted',
    '--config.auto-install-peers=false',
    '--config.link-workspace-packages=true',
    sdkClosureRoot,
  ])
  restoreSdkLegacyHoists()
  materializeRuntimeLinks(sdkClosureRoot)

  const sourceNodeModules = join(sdkClosureRoot, 'node_modules')
  const destinationNodeModules = join(runtimeApp, 'node_modules')
  if (!existsSync(sourceNodeModules)) {
    throw new Error('SDK runtime deploy produced no node_modules closure')
  }
  mkdirSync(destinationNodeModules, { recursive: true })

  // Merge only packages that the CLI deploy does not already contain. Overwriting
  // an existing hoisted package tree is both unnecessary and brittle on Windows:
  // antivirus/indexing can briefly hold files open after lifecycle scripts finish.
  // The SDK closure is used strictly to fill missing runtime peers.
  for (const entry of readdirSync(sourceNodeModules, { withFileTypes: true })) {
    if (entry.name === '.bin' || entry.name === '.pnpm') continue
    const source = join(sourceNodeModules, entry.name)
    const destination = join(destinationNodeModules, entry.name)

    if (entry.name.startsWith('@') && entry.isDirectory()) {
      mkdirSync(destination, { recursive: true })
      for (const scopedEntry of readdirSync(source, { withFileTypes: true })) {
        const scopedSource = join(source, scopedEntry.name)
        const scopedDestination = join(destination, scopedEntry.name)
        if (existsSync(scopedDestination)) continue
        cpSync(scopedSource, scopedDestination, { recursive: true, dereference: true })
      }
      continue
    }

    if (existsSync(destination)) continue
    cpSync(source, destination, { recursive: true, dereference: true })
  }

  rmSync(sdkClosureRoot, { recursive: true, force: true })
  materializeRuntimeLinks(runtimeApp)
}

function deployRuntimeApp() {
  runPnpm([
    '--filter', '@phoenix-ai/dsh',
    'deploy',
    '--legacy',
    '--config.node-linker=hoisted',
    '--config.link-workspace-packages=true',
    runtimeApp,
  ])
  materializeRuntimeLinks()
  mergeVerifiedSdkClosure()

  const entry = join(runtimeApp, 'lib', 'bin.js')
  if (!existsSync(entry)) throw new Error(`deployed Phoenix CLI entrypoint is missing: ${entry}`)

  run(process.execPath, [entry, '--version'], { cwd: runtimeApp })
  run(process.execPath, [entry, 'web', '--dump-config'], {
    cwd: seedRoot,
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
rmSync(sdkClosureRoot, { recursive: true, force: true })
mkdirSync(seedRoot, { recursive: true })
copyTrackedSource()
deployRuntimeApp()
preserveUpdaterCleanliness()

console.log(`Windows production runtime seed ready: ${seedRoot}`)
