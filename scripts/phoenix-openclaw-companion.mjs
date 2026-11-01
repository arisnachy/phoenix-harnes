#!/usr/bin/env node
/**
 * PHOENIX optional OpenClaw companion CLI.
 *
 * Explicitly delegated functionality only. No plugin is loaded inside the
 * PHOENIX Host and browser text is never captured by a background probe.
 *
 * Usage:
 *   node scripts/phoenix-openclaw-companion.mjs status
 *   node scripts/phoenix-openclaw-companion.mjs browser-status
 *   node scripts/phoenix-openclaw-companion.mjs plugins
 *   node scripts/phoenix-openclaw-companion.mjs lobster
 *   node scripts/phoenix-openclaw-companion.mjs browser-snapshot --approve-capture
 */
import { spawnSync } from 'node:child_process'

const commands = {
  status: ['gateway', 'status', '--json'],
  'browser-status': ['browser', '--json', 'status'],
  plugins: ['plugins', 'list', '--json'],
  lobster: ['plugins', 'inspect', 'lobster', '--runtime', '--json'],
  'browser-snapshot': ['browser', '--browser-profile', 'openclaw', 'snapshot'],
}
const action = process.argv[2]
const approved = process.argv.includes('--approve-capture')
if (!(action in commands)) {
  process.stdout.write('PHOENIX OpenClaw companion: status | browser-status | plugins | lobster | browser-snapshot --approve-capture\n')
  process.exitCode = action === undefined || action === '--help' ? 0 : 2
} else if (action === 'browser-snapshot' && !approved) {
  process.stderr.write('Browser content capture requires explicit --approve-capture.\n')
  process.exitCode = 2
} else {
  const result = spawnSync(process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw', commands[action], {
    encoding: 'utf8',
    timeout: action === 'browser-snapshot' ? 30_000 : 12_000,
    maxBuffer: 256 * 1024,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(process.platform === 'win32' ? { shell: true } : {}),
  })
  if (result.error !== undefined || result.status !== 0) {
    // Do not mirror potentially secret-bearing stderr from another runtime.
    process.stderr.write('OpenClaw companion unavailable or command failed; check the OpenClaw installation and Gateway.\n')
    process.exitCode = 1
  } else if (action === 'browser-snapshot') {
    // The user explicitly authorized this managed-profile capture.
    process.stdout.write((result.stdout || '').slice(0, 120_000))
  } else if (action === 'plugins' || action === 'lobster') {
    // Metadata only; raw OpenClaw config may contain tokens or local paths.
    const raw = (result.stdout || '').trim()
    let parsed
    try { parsed = JSON.parse(raw) } catch { parsed = null }
    const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.plugins) ? parsed.plugins : []
    const names = entries.map(item => item?.id || item?.name).filter(value =>
      typeof value === 'string' && /^[A-Za-z0-9@/_.-]{1,120}$/.test(value)).slice(0, 80)
    process.stdout.write(JSON.stringify({ command: action, responded: true, pluginIds: names }, null, 2) + '\n')
  } else {
    process.stdout.write(JSON.stringify({ command: action, responded: true,
      note: 'Command exit status only; not evidence of live browser or Gateway capability.' }, null, 2) + '\n')
  }
}
