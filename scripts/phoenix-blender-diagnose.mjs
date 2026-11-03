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
const uvx = executableOnPath('uvx')
const bridgePortOpen = await bridgePortReachable()
const findings = []
if (blenderPaths.length === 0) findings.push('Blender executable not detected in the known Windows locations or PATH.')
if (!uvx) findings.push('uvx is not available on the current PHOENIX process PATH.')
if (!bridgePortOpen) findings.push('Blender Lab add-on TCP bridge is not responding on 127.0.0.1:9876.')
findings.push('A TCP listener alone does not confirm MCP tools or a working Blender add-on.')
const result = {
  blenderDetected: blenderPaths.length > 0,
  blenderExecutables: blenderPaths,
  uvxDetected: Boolean(uvx),
  uvxPath: uvx ?? null,
  blenderLabPortOpen: bridgePortOpen,
  note: 'Verify mcp__blender__ tools separately in the live PHOENIX MCP connector state.',
  findings,
}
process.stdout.write(JSON.stringify(result, null, 2) + '\n')
