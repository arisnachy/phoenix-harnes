#!/usr/bin/env node
/**
 * Godot Game Studio: actual on-demand editor installation, starter project and
 * headless game checks. Never invoked at Phoenix boot / by the update watcher.
 * Authorization for installing a program is the explicit --allow-install flag.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..', '..')
const template = join(here, 'starter')
const installer = join(repo, 'apps', 'cli', 'config', 'agent-presets', 'code',
  'skills', 'game-development', 'scripts', 'game-tools.mjs')
export const GODOT_STARTER_FILES = [
  'project.godot', 'scenes/main.tscn', 'scripts/main.gd', 'scripts/hero.gd',
  'scripts/boss.gd', 'tests/smoke.gd', 'GAME_PLAN.md',
]

export function godotInvocation(inspection) {
  if (inspection?.ready !== true || typeof inspection.command !== 'string') {
    throw new Error('Godot executable has not been verified; run setup --allow-install')
  }
  if (!/^4\.\d+/u.test(String(inspection.version).trim())) {
    throw new Error('Godot 4 version has not been verified')
  }
  return inspection.command === 'flatpak'
    ? { bin: 'flatpak', prefix: ['run', 'org.godotengine.Godot'] }
    : { bin: inspection.command, prefix: [] }
}

export function scaffoldGodotProject(project, { exists = existsSync, mkdir = mkdirSync,
  read = readFileSync, list = readdirSync, write = writeFileSync } = {}) {
  const target = resolve(project)
  if (exists(join(target, 'project.godot'))) {
    return { project: target, created: false, reused: true }
  }
  if (exists(target) && list(target).length > 0) {
    throw new Error('Refusing to scaffold inside a non-empty directory without project.godot')
  }
  const present = GODOT_STARTER_FILES.filter(path => exists(join(target, path)))
  if (present.length) {
    if (exists(join(target, 'project.godot'))) {
      return { project: target, created: false, reused: true }
    }
    throw new Error('Refusing to overwrite existing project files: ' + present.join(', '))
  }
  const files = GODOT_STARTER_FILES.map(path => ({ path, bytes: read(join(template, path)) }))
  for (const file of files) {
    const dest = join(target, file.path)
    mkdir(dirname(dest), { recursive: true })
    write(dest, file.bytes, { flag: 'wx' })
  }
  return { project: target, created: true, reused: false, files: GODOT_STARTER_FILES }
}

function exec(command, args, timeout = 120_000) {
  const result = spawnSync(command, args, {
    cwd: repo, encoding: 'utf8', shell: false, windowsHide: true,
    timeout, maxBuffer: 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    throw new Error('Godot command failed (' + String(result.error?.code ?? result.status) +
      '): ' + command + ' ' + args.slice(0, 3).join(' ') + '; ' +
      String(result.stderr || '').slice(-1000))
  }
  return [result.stdout, result.stderr].filter(Boolean).join('\n')
}
function doctor() {
  const result = spawnSync(process.execPath, [installer, 'doctor', '--target', 'godot'], {
    cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 18_000,
  })
  try { return JSON.parse(String(result.stdout).trim()) } catch {
    throw new Error('game-tools.mjs doctor did not return JSON: check executable discovery')
  }
}

export function verifyGodotProject(project, inspected, run = exec, exists = existsSync) {
  const dir = resolve(project)
  if (!exists(join(dir, 'project.godot'))) throw new Error('Missing project.godot')
  if (!exists(join(dir, 'tests', 'smoke.gd'))) throw new Error('Missing executable Godot tests/smoke.gd')
  const { bin, prefix } = godotInvocation(inspected)
  const checks = [
    { label: 'import', args: ['--headless', '--path', dir, '--import'] },
    { label: 'smoke', args: ['--headless', '--path', dir, '--script', 'res://tests/smoke.gd'] },
    { label: 'run', args: ['--headless', '--path', dir, '--quit-after', '120'] },
  ]
  for (const step of checks) {
    const output = run(bin, [...prefix, ...step.args])
    if (/SCRIPT ERROR:|Parse Error:|ERROR:.*(?:parse|script|resource)/iu.test(output)) {
      throw new Error('Godot ' + step.label + ' error: ' + output.slice(-1200))
    }
    if (step.label === 'smoke' && !output.includes('PHOENIX_GODOT_SMOKE_OK')) {
      throw new Error('Godot smoke returned no PHOENIX_GODOT_SMOKE_OK evidence')
    }
  }
  return { project: dir, verified: true, checks: checks.map(x => x.label),
    artwork: 'prototype-needs-approved-sprites-and-sampled-audio' }
}

function main(args = process.argv.slice(2)) {
  const [action, ...rest] = args
  if (!['doctor', 'init', 'verify', 'setup'].includes(action)) {
    throw new Error('Usage: bootstrap.mjs doctor|init|verify|setup [--project DIR] [--allow-install]')
  }
  const flags = {}
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--allow-install' && !flags.allowInstall) flags.allowInstall = true
    else if (rest[i] === '--project' && rest[i + 1] && !flags.project) {
      flags.project = resolve(rest[++i])
    } else throw new Error('Malformed or repeated bootstrap argument')
  }
  if (flags.allowInstall && action !== 'setup') throw new Error('--allow-install is only for setup')
  if (action === 'doctor') {
    console.log(JSON.stringify({ engine: 'godot', ...doctor() }))
    return
  }
  if (!flags.project) throw new Error('--project DIR is required')
  if (action === 'init') {
    console.log(JSON.stringify(scaffoldGodotProject(flags.project)))
    return
  }
  let result = doctor()
  if (!result.ready && action === 'setup') {
    if (!flags.allowInstall) throw new Error('Godot is missing; --allow-install is required')
    // Official allowlisted package manager and explicit user permission only.
    exec(process.execPath, [installer, 'ensure', '--target', 'godot', '--allow-install'], 650_000)
    result = doctor()
  }
  if (!result.ready) throw new Error('Godot not detected: configure PHOENIX_GODOT_BIN or reopen terminal')
  const scaffold = action === 'setup' ? scaffoldGodotProject(flags.project) : undefined
  const verification = verifyGodotProject(flags.project, result)
  console.log(JSON.stringify({ engine: 'godot', version: result.version, executable: result.command,
    ...(scaffold === undefined ? {} : { scaffold }), ...verification }))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) {
    console.error(JSON.stringify({ status: 'blocked',
      error: error instanceof Error ? error.message : String(error) }))
    process.exitCode = 1
  }
}
