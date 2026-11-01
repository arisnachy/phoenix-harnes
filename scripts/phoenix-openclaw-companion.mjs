#!/usr/bin/env node
/** Explicit companion diagnostics; privileged operations require separate authorization. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

const commands = {
  status: ['gateway', 'status', '--json'],
  'browser-status': ['browser', '--json', 'status'],
  plugins: ['plugins', 'list', '--json'],
  lobster: ['plugins', 'inspect', 'lobster', '--runtime', '--json'],
  'browser-snapshot': ['browser', '--browser-profile', 'openclaw', 'snapshot'],
}
const action = process.argv[2]
const approved = process.argv.includes('--approve-capture')

function resolveCli() {
  const file = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    'toolchains', 'openclaw', 'node_modules', 'openclaw', 'package.json')
  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'))
      const bin = typeof data.bin === 'string' ? data.bin : data.bin?.openclaw
      if (typeof bin === 'string') {
        const folder = dirname(file)
        const entry = resolve(folder, bin)
        const relativePath = relative(folder, entry)
        if (relativePath && !relativePath.startsWith('..') && existsSync(entry)) {
          return { program: process.execPath, prefix: [entry], shell: false }
        }
      }
    } catch {}
  }
  return process.platform === 'win32'
    ? { program: 'cmd.exe', prefix: ['/d', '/s', '/c', 'openclaw.cmd'], shell: false }
    : { program: 'openclaw', prefix: [], shell: false }
}

if (!(action in commands)) {
  process.stdout.write('PHOENIX OpenClaw: status | browser-status | plugins | lobster | browser-snapshot --approve-capture\n')
  process.exitCode = action === undefined || action === '--help' ? 0 : 2
} else if (action === 'browser-snapshot' && !approved) {
  process.stderr.write('A browser snapshot requires explicit --approve-capture.\n')
  process.exitCode = 2
} else {
  const cli = resolveCli()
  const result = spawnSync(cli.program, [...cli.prefix, ...commands[action]], {
    encoding: 'utf8',
    timeout: action === 'browser-snapshot' ? 30_000 : 12_000,
    maxBuffer: 256 * 1024,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  if (result.error !== undefined || result.status !== 0) {
    process.stderr.write('OpenClaw companion unavailable. Check CLI version, Node, Gateway and permissions.\n')
    process.exitCode = 1
  } else if (action === 'browser-snapshot') {
    process.stdout.write((result.stdout || '').slice(0, 120_000))
  } else if (action === 'plugins' || action === 'lobster') {
    let parsed
    try { parsed = JSON.parse((result.stdout || '').trim()) } catch { parsed = null }
    const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.plugins) ? parsed.plugins : []
    const ids = entries.map(item => item?.id || item?.name).filter(value =>
      typeof value === 'string' && /^[A-Za-z0-9@/_.-]{1,120}$/.test(value)).slice(0, 80)
    process.stdout.write(JSON.stringify({ command: action, responded: true, pluginIds: ids }, null, 2) + '\n')
  } else {
    process.stdout.write(JSON.stringify({
      command: action, responded: true,
      note: 'CLI exited successfully; no live tool authority is inferred.',
    }, null, 2) + '\n')
  }
}
