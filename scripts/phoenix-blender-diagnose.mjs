#!/usr/bin/env node
/**
 * Read-only local diagnostic for the official PHOENIX Blender Lab connector.
 * A listening port is NOT proof that the Blender add-on is authenticated or
 * that PHOENIX has a callable MCP tool; this is only an installation preflight.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { connect } from 'node:net'
import { join, resolve } from 'node:path'
import process from 'node:process'

function executableOnPath(name) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which'
  const candidate = process.platform === 'win32' ? `${name}.exe` : name
  const result = spawnSync(locator, [candidate], {
    encoding: 'utf8', windowsHide: true, timeout: 3_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0) return undefined
  return result.stdout.split(/\r?\n/u).map(part => part.trim()).find(Boolean)
}

function installedBlenderCandidates() {
  const paths = new Set()
  const explicit = process.env.BLENDER_PATH?.trim()
  if (explicit && existsSync(explicit)) paths.add(resolve(explicit))
  const onPath = executableOnPath('blender')
  if (onPath && existsSync(onPath)) paths.add(resolve(onPath))
  if (process.platform !== 'win32') return [...paths]

  const programRoots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs'),
  ].filter(Boolean)
  for (const base of programRoots) {
    const parent = join(base, 'Blender Foundation')
    if (!existsSync(parent)) continue
    let versions
    try { versions = readdirSync(parent) } catch { continue }
    for (const name of versions) {
      const path = join(parent, name, 'blender.exe')
      try {
        if (statSync(path).isFile()) paths.add(resolve(path))
      } catch { /* A partial/removed installation is not a candidate. */ }
    }
  }
  return [...paths]
}

function installedUvxCandidates() {
  const paths = new Set()
  const onPath = executableOnPath('uvx')
  if (onPath && existsSync(onPath)) paths.add(resolve(onPath))
  if (process.platform !== 'win32') return [...paths]
  const user = process.env.USERPROFILE
  const local = process.env.LOCALAPPDATA
  const install = process.env.UV_INSTALL_DIR
  for (const candidate of [
    user && join(user, '.local', 'bin', 'uvx.exe'),
    user && join(user, '.cargo', 'bin', 'uvx.exe'),
    user && join(user, 'scoop', 'shims', 'uvx.exe'),
    local && join(local, 'Microsoft', 'WinGet', 'Links', 'uvx.exe'),
    local && join(local, 'Programs', 'uv', 'uvx.exe'),
    install && join(install, 'uvx.exe'),
  ]) {
    if (!candidate) continue
    try { if (statSync(candidate).isFile()) paths.add(resolve(candidate)) }
    catch { /* Deleted or partial uv installation; do not claim it is ready. */ }
  }
  return [...paths]
}

function bridgePortReachable() {
  return new Promise(resolveReachability => {
    const socket = connect({ host: '127.0.0.1', port: 9876 })
    let completed = false
    const finish = reachable => {
      if (completed) return
      completed = true
      socket.destroy()
      resolveReachability(reachable)
    }
    socket.setTimeout(800)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

const blenderPaths = installedBlenderCandidates()
const uvxPaths = installedUvxCandidates()
const bridgePortOpen = await bridgePortReachable()
const gitConfigCount = Number(process.env.GIT_CONFIG_COUNT ?? 0)
const brokenInlineGitConfig = Number.isInteger(gitConfigCount) && gitConfigCount > 0
  && (gitConfigCount > 64 || Array.from({ length: gitConfigCount }, (_, index) =>
    process.env[`GIT_CONFIG_KEY_${index}`] === undefined
      || process.env[`GIT_CONFIG_VALUE_${index}`] === undefined).some(Boolean))
const findings = []
if (blenderPaths.length === 0) findings.push('Blender executable not detected in the known Windows locations or PATH.')
if (uvxPaths.length === 0) findings.push('uvx is not installed in known Windows locations or on the current PHOENIX process PATH.')
if (!bridgePortOpen) findings.push('Blender Lab add-on TCP bridge is not responding on 127.0.0.1:9876.')
if (brokenInlineGitConfig) findings.push('Parent Git inline config has missing GIT_CONFIG_KEY_n/GIT_CONFIG_VALUE_n. PHOENIX repairs this for Blender MCP by stripping transient config tuples before uvx runs. Reconnect after updating.')
findings.push('A TCP listener alone does not confirm MCP tools or a working Blender add-on.')
const result = {
  blenderDetected: blenderPaths.length > 0,
  blenderExecutables: blenderPaths,
  uvxDetected: uvxPaths.length > 0,
  uvxPath: uvxPaths[0] ?? null,
  blenderLabPortOpen: bridgePortOpen,
  brokenInlineGitConfig,
  note: 'Verify mcp__blender__ tools separately in the live PHOENIX MCP connector state.',
  actions: [
    'Open Blender 5.1+ and enable the official Blender Lab MCP add-on. Start its server or enable Auto-start in add-on preferences.',
    'In PHOENIX Settings > Connectors > Blender Lab, choose Install, Reconnect, or Repair as appropriate.',
    'After activation, verify the mcp__blender__ tool namespace and perform one non-destructive test call.',
  ],
  findings,
}
process.stdout.write(JSON.stringify(result, null, 2) + '\n')
