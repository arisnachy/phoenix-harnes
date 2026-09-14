#!/usr/bin/env node
/**
 * Boundary proxy for MCP servers that write JSON-RPC over stdio.
 *
 * The MCP SDK server transport does not attach an error listener to stdout.
 * Keeping the child behind this proxy prevents a late write from turning a
 * normal Host shutdown into an unhandled EPIPE. It also preserves Google's
 * refresh_token when the workspace package saves a refresh response that omits
 * it.
 */

import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export function isExpectedStdioBrokenPipe(error) {
  if (error?.code === 'EPIPE') return true
  return error instanceof Error && /\bEPIPE\b/.test(error.message)
}

const WINDOWS_COMMAND_SHIMS = new Set(['corepack', 'npm', 'npx', 'pnpm', 'yarn'])

export function resolveChildCommand(command, platform = process.platform) {
  if (platform !== 'win32' || !WINDOWS_COMMAND_SHIMS.has(command) || /\.(?:cmd|exe|com|bat)$/i.test(command)) {
    return command
  }
  return `${command}.cmd`
}

export function childSpawnOptions(command, platform = process.platform) {
  return { shell: platform === 'win32' && WINDOWS_COMMAND_SHIMS.has(command) }
}

const tokenPath = join(homedir(), '.google-workspace-mcp', 'token.json')

async function readToken() {
  try {
    const value = JSON.parse(await readFile(tokenPath, 'utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

async function preserveRefreshToken(state) {
  let refreshToken = typeof state?.refresh_token === 'string' && state.refresh_token.length > 0
    ? state.refresh_token
    : undefined

  const reconcile = async () => {
    const current = await readToken()
    if (typeof current?.refresh_token === 'string' && current.refresh_token.length > 0) {
      refreshToken = current.refresh_token
      return
    }
    if (refreshToken === undefined || current === undefined) return
    await writeFile(tokenPath, `${JSON.stringify({ ...current, refresh_token: refreshToken }, null, 2)}\n`, 'utf8')
  }

  const timer = setInterval(() => { void reconcile() }, 250)
  timer.unref?.()
  return () => clearInterval(timer)
}

function forward(source, target, onTargetClosed) {
  source.on('data', (chunk) => {
    try {
      if (target.destroyed || target.writableEnded) return
      if (!target.write(chunk)) {
        source.pause()
        target.once('drain', () => source.resume())
      }
    } catch (error) {
      if (!isExpectedStdioBrokenPipe(error)) onTargetClosed(error)
      else onTargetClosed(error)
    }
  })
  source.on('end', () => {
    try { if (!target.writableEnded) target.end() } catch (error) { onTargetClosed(error) }
  })
  source.on('error', onTargetClosed)
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === undefined || command.length === 0) {
    console.error('mcp-stdio-proxy: expected a child command')
    process.exitCode = 2
    return
  }

  const cleanupToken = await preserveRefreshToken(await readToken())
  const child = spawn(resolveChildCommand(command), args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
    ...childSpawnOptions(command),
  })
  let downstreamClosed = false
  const closeChild = () => {
    if (downstreamClosed) return
    downstreamClosed = true
    child.stdout.pause()
    if (child.exitCode === null) child.kill()
  }

  const stdoutError = (error) => {
    if (isExpectedStdioBrokenPipe(error)) closeChild()
    else closeChild()
  }
  process.stdout.on('error', stdoutError)
  child.stdout.on('error', stdoutError)
  child.stdin.on('error', () => {})
  process.stdin.on('error', () => {})

  forward(process.stdin, child.stdin, () => {
    try { child.stdin.end() } catch { /* child is already gone */ }
  })
  forward(child.stdout, process.stdout, closeChild)

  const stopChild = () => {
    if (child.exitCode === null) child.kill()
  }
  process.once('SIGINT', stopChild)
  process.once('SIGTERM', stopChild)

  const stopInputForwarding = () => {
    process.stdin.pause()
    process.stdin.removeAllListeners('data')
    process.stdin.removeAllListeners('end')
    process.stdin.removeAllListeners('error')
  }

  await new Promise((resolve) => {
    child.once('error', () => {
      stopInputForwarding()
      cleanupToken()
      process.exitCode = 1
      resolve()
    })
    child.once('exit', (code, signal) => {
      stopInputForwarding()
      cleanupToken()
      process.exitCode = code ?? (signal === null ? 1 : 0)
      resolve()
    })
  })
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
