#!/usr/bin/env node
/**
 * Trusted Blender Lab MCP stdio launcher for PHOENIX.
 *
 * Prefer the user's already-synced local Python environment. It works without
 * another Git checkout, uv lock, or network connection. Other installations
 * retain the official v1.0.2 uvx fallback.
 *
 * Never print progress on stdout: the MCP JSON-RPC stream owns that channel.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const PINNED_SOURCE = 'git+https://projects.blender.org/lab/blender_mcp.git@v1.0.2#subdirectory=mcp'
const environment = { ...process.env, BLENDER_MCP_HOST: '127.0.0.1', BLENDER_MCP_PORT: '9876' }

// PHOENIX/Git wrappers may leave a half-populated Git config tuple behind.
// Such environment variables make uvx's Git subprocess fail before startup.
for (const key of Object.keys(environment)) {
  if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/i.test(key)) delete environment[key]
}

const localAppData = process.env.LOCALAPPDATA
const directory = localAppData
  ? join(localAppData, 'PHOENIX', 'tools', 'blender_mcp', 'mcp')
  : undefined
const executable = directory
  ? join(directory, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'blender-mcp.exe' : 'blender-mcp')
  : undefined
const useLocal = directory !== undefined && executable !== undefined
  && existsSync(join(directory, 'pyproject.toml')) && existsSync(executable)

const command = useLocal ? executable : 'uvx'
const args = useLocal ? [] : ['--from', PINNED_SOURCE, 'blender-mcp']

const child = spawn(command, args, {
  env: environment,
  stdio: 'inherit',
  windowsHide: true,
  shell: false,
})

child.once('error', error => {
  process.stderr.write(`PHOENIX Blender MCP launch failed: ${error.message}\n`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}
