#!/usr/bin/env node
/**
 * Transparent stdio bridge for MCP commands configured through PHOENIX.
 *
 * The bridge keeps the MCP JSON-RPC stream on stdin/stdout while allowing
 * Windows command shims such as npx.cmd to be launched reliably.
 */

import { spawn } from 'node:child_process'
import process from 'node:process'

const EXPECTED_TRANSPORT_CLOSE = new Set(['EPIPE', 'ERR_STREAM_DESTROYED'])
const stdioGuardUrl = new URL('./mcp-stdio-epipe-guard.mjs', import.meta.url).href

function resolveChildCommand(command) {
  if (process.platform === 'win32' && command === 'npx') return 'npx.cmd'
  return command
}

function childEnvironment() {
  const inheritedNodeOptions = process.env.NODE_OPTIONS?.trim() ?? ''
  const guardOption = `--import=${stdioGuardUrl}`
  if (inheritedNodeOptions.includes(stdioGuardUrl)) return process.env
  return {
    ...process.env,
    NODE_OPTIONS: inheritedNodeOptions === ''
      ? guardOption
      : `${inheritedNodeOptions} ${guardOption}`,
  }
}

function childSpawnOptions(command) {
  const usesWindowsShim = process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')
  return {
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
    shell: usesWindowsShim,
    env: childEnvironment(),
  }
}

function forwardStreamErrors(stream, label) {
  stream.on('error', (error) => {
    if (!EXPECTED_TRANSPORT_CLOSE.has(error?.code)) {
      console.error(`[PHOENIX MCP proxy] ${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

function main() {
  const [requestedCommand, ...args] = process.argv.slice(2)
  if (requestedCommand === undefined || requestedCommand.trim() === '') {
    console.error('[PHOENIX MCP proxy] missing child command')
    process.exitCode = 2
    return
  }

  const command = resolveChildCommand(requestedCommand)
  const child = spawn(command, args, childSpawnOptions(command))
  let shuttingDown = false

  process.stdin.pipe(child.stdin)
  child.stdout.pipe(process.stdout)
  forwardStreamErrors(process.stdin, 'stdin')
  forwardStreamErrors(process.stdout, 'stdout')
  forwardStreamErrors(child.stdin, 'child stdin')
  forwardStreamErrors(child.stdout, 'child stdout')

  const requestShutdown = (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    child.kill(signal)
  }
  process.once('SIGINT', () => requestShutdown('SIGINT'))
  process.once('SIGTERM', () => requestShutdown('SIGTERM'))

  child.once('error', (error) => {
    console.error(`[PHOENIX MCP proxy] could not launch ${command}: ${error.message}`)
    process.exitCode = 1
  })
  child.once('close', (code, signal) => {
    process.exitCode = signal === null ? (code ?? 1) : 1
  })
}

main()
