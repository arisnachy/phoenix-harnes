import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { diagnoseStalledPhoenixActivation, recordPhoenixUpdateStep, sanitizePhoenixUpdateDiagnostic, writePhoenixUpdateState } from './phoenix-update-state.mjs'

const roots: string[] = []
const originalSupervised = process.env.PHOENIX_UPDATE_SUPERVISED
const originalAutoUpdate = process.env.PHOENIX_AUTO_UPDATE
const originalUpdateMode = process.env.PHOENIX_UPDATE_MODE

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (originalSupervised === undefined) delete process.env.PHOENIX_UPDATE_SUPERVISED
  else process.env.PHOENIX_UPDATE_SUPERVISED = originalSupervised
  if (originalAutoUpdate === undefined) delete process.env.PHOENIX_AUTO_UPDATE
  else process.env.PHOENIX_AUTO_UPDATE = originalAutoUpdate
  if (originalUpdateMode === undefined) delete process.env.PHOENIX_UPDATE_MODE
  else process.env.PHOENIX_UPDATE_MODE = originalUpdateMode
})

describe('PHOENIX updater state persistence', () => {
  it('records only fixed step codes and actual outcomes, never raw command output', () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-update-journal-'))
    roots.push(root)
    const path = join(root, 'phoenix-update-state.json')
    const target = 'd'.repeat(40)
    writePhoenixUpdateState(path, { schema: 1, status: 'preparing', phase: 'dependencies', target })
    recordPhoenixUpdateStep(path, 'dependencies', 'started', target)
    recordPhoenixUpdateStep(path, 'dependencies', 'failed', target, 9)
    recordPhoenixUpdateStep(path, 'rm -rf password=supersecret', 'failed', target, 1)
    const entries = readFileSync(join(root, 'phoenix-update-events.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(entries).toEqual([
      expect.objectContaining({ step: 'preparing', result: 'info', target }),
      expect.objectContaining({ step: 'dependencies', result: 'started', target }),
      expect.objectContaining({ step: 'dependencies', result: 'failed', exitCode: 9, target }),
    ])
    expect(JSON.stringify(entries)).not.toContain('supersecret')
  })

  it('keeps the complete failing command trace but strips credentials before writing the journal', () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-update-error-output-'))
    roots.push(root)
    const path = join(root, 'phoenix-update-state.json')
    const target = 'e'.repeat(40)
    const trace = [
      'PowerShell : Failed to start new Host',
      '  at C:\\Phoenix\\scripts\\activate.ps1:102 char:5',
      'Error: EADDRINUSE: address already in use 127.0.0.1:3080',
      '    at Server.setupListenHandle (node:net:1900:16)',
      'Authorization: Bearer token-that-must-not-appear',
      'password=private-pw-123',
      'client_secret: sensitive-secret-xyz',
      'OPENROUTER_API_KEY=supersecret-openrouter-key',
      'sk-proj-abcdefghijklmnopqrstuvwxyz123456',
    ].join('\n')
    recordPhoenixUpdateStep(path, 'runtime-activation', 'failed', target, 1, trace)
    const journal = readFileSync(join(root, 'phoenix-update-events.jsonl'), 'utf8')
    const event = JSON.parse(journal) as { diagnostic: string; exitCode: number }
    expect(event.exitCode).toBe(1)
    expect(event.diagnostic).toContain('EADDRINUSE')
    expect(event.diagnostic).toContain('node:net:1900:16')
    expect(event.diagnostic).toContain('activate.ps1')
    expect(event.diagnostic).not.toContain('private-pw-123')
    expect(event.diagnostic).not.toContain('token-that-must-not-appear')
    expect(event.diagnostic).not.toContain('sensitive-secret-xyz')
    expect(event.diagnostic).not.toContain('supersecret-openrouter-key')
    expect(event.diagnostic).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz123456')
    expect(event.diagnostic).toContain('[SECRET_REMOVED]')
    expect(sanitizePhoenixUpdateDiagnostic('Error: unavailable')).toBe('Error: unavailable')
    expect(sanitizePhoenixUpdateDiagnostic('')).toBeUndefined()
    expect(sanitizePhoenixUpdateDiagnostic('x'.repeat(110_000))).toContain('[Earlier output truncated')
    recordPhoenixUpdateStep(path, 'build', 'ok', target, 0, 'should not be shown')
    expect(readFileSync(join(root, 'phoenix-update-events.jsonl'), 'utf8')).not.toContain('should not be shown')
  })

  it('captures real child stdout/stderr and a failing exit code in the live journal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phoenix-update-live-'))
    roots.push(dir)
    const statePath = join(dir, 'phoenix-update-state.json')
    const target = 'f'.repeat(40)
    const code = [
      "process.stdout.write('Compiling 1/2\\n')",
      "process.stderr.write('PowerShell: EADDRINUSE\\n')",
      "process.stderr.write('OPENROUTER_API_KEY=private-value\\n')",
      'process.exitCode = 7',
    ].join(';')
    const command = spawnSync(process.execPath, [
      join(process.cwd(), 'scripts', 'phoenix-update-live-command.mjs'),
      JSON.stringify({ statePath, target, step: 'build', cwd: process.cwd(),
        bin: process.execPath, args: ['-e', code] }),
    ], { encoding: 'utf8' })
    expect(command.status, command.stderr).toBe(7)
    expect(command.stdout).toContain('Compiling 1/2')
    const records = readFileSync(join(dir, 'phoenix-update-live.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line))
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ step: 'build', stream: 'stdout',
        line: expect.stringContaining('Compiling 1/2') }),
      expect.objectContaining({ step: 'build', stream: 'stderr',
        line: expect.stringContaining('EADDRINUSE') }),
    ]))
    expect(JSON.stringify(records)).not.toContain('private-value')
    const events = readFileSync(join(dir, 'phoenix-update-events.jsonl'), 'utf8')
    expect(events).toContain('"exitCode":7')
  })

  it('turns a genuinely stalled restart into an actionable diagnostic without inventing a PowerShell error', () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-update-stall-'))
    roots.push(root)
    const target = 'a'.repeat(40)
    const path = join(root, 'phoenix-update-state.json')
    const now = Date.parse('2026-10-25T16:00:00Z')
    writeFileSync(path, JSON.stringify({
      schema: 1, status: 'restarting', phase: 'restart', target,
      at: new Date(now - 16 * 60_000).toISOString(),
    }))
    writeFileSync(join(root, 'phoenix-update-restart-request.json'),
      JSON.stringify({ schema: 1, target, requestedAt: new Date(now - 16 * 60_000).toISOString() }))
    expect(diagnoseStalledPhoenixActivation(path, now)).toBe(true)
    const state = JSON.parse(readFileSync(path, 'utf8'))
    expect(state).toMatchObject({ status: 'error', phase: 'supervisor-timeout', target })
    const events = readFileSync(join(root, 'phoenix-update-events.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line))
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ step: 'host-restart', result: 'failed', target }),
    ]))
    const diagnostic = events.find(event => event.step === 'host-restart')?.diagnostic as string
    expect(diagnostic).toContain('Supervisor observado en los últimos 30 segundos: no')
    expect(diagnostic).toContain('Solicitud de activación pendiente: sí')
    expect(diagnostic).toContain('No existe un código de salida')
    expect(diagnoseStalledPhoenixActivation(path, now + 60_000)).toBe(false)
    expect(readFileSync(join(root, 'phoenix-update-events.jsonl'), 'utf8')
      .split('\n').filter(line => line.includes('"step":"host-restart"'))).toHaveLength(1)
  })

  it('does not flag healthy, recent or completed handoffs as failures', () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-update-stall-safe-'))
    roots.push(root)
    const path = join(root, 'phoenix-update-state.json')
    const now = Date.parse('2026-10-25T16:00:00Z')
    const target = 'b'.repeat(40)
    const setStatus = (status: string, ageMinutes: number) =>
      writeFileSync(path, JSON.stringify({
        schema: 1, status, phase: 'restart', target,
        at: new Date(now - ageMinutes * 60_000).toISOString(),
      }))
    setStatus('restarting', 2)
    expect(diagnoseStalledPhoenixActivation(path, now)).toBe(false)
    setStatus('updated', 55)
    expect(diagnoseStalledPhoenixActivation(path, now)).toBe(false)
    setStatus('restarting', 16)
    writeFileSync(join(root, 'phoenix-update-supervisor-heartbeat.json'),
      JSON.stringify({ schema: 1, at: new Date(now - 2_000).toISOString(), supervisorPid: 1234 }))
    expect(diagnoseStalledPhoenixActivation(path, now)).toBe(true)
    const entries = readFileSync(join(root, 'phoenix-update-events.jsonl'), 'utf8')
    expect(entries).toContain('Supervisor observado en los últimos 30 segundos: sí')
  })

  it('replaces the state document atomically and leaves no temporary file', () => {
    process.env.PHOENIX_UPDATE_SUPERVISED = '0'
    const root = mkdtempSync(join(tmpdir(), 'phoenix-update-state-write-'))
    roots.push(root)
    const path = join(root, 'phoenix-update-state.json')

    writePhoenixUpdateState(path, { schema: 1, status: 'checking' })
    writePhoenixUpdateState(path, { schema: 1, status: 'ready', target: 'a'.repeat(40) })

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ schema: 1, status: 'ready', target: 'a'.repeat(40) })
    expect(existsSync(`${path}.tmp`)).toBe(false)
    expect(readdirSync(root).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('requests activation and host restart as soon as a supervised auto update becomes ready', () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-update-ready-'))
    roots.push(root)
    const path = join(root, 'phoenix-update-state.json')
    const target = 'b'.repeat(40)
    process.env.PHOENIX_UPDATE_SUPERVISED = '1'
    process.env.PHOENIX_AUTO_UPDATE = '1'
    process.env.PHOENIX_UPDATE_MODE = 'auto'

    writePhoenixUpdateState(path, { schema: 1, status: 'ready', target })

    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      schema: 1,
      status: 'restarting',
      phase: 'restart',
      target,
    })
    expect(JSON.parse(readFileSync(join(root, 'phoenix-update-restart-request.json'), 'utf8'))).toMatchObject({
      schema: 1,
      target,
    })
    expect(JSON.parse(readFileSync(join(root, 'phoenix-host-restart-request.json'), 'utf8'))).toMatchObject({
      schema: 1,
      kind: 'host-restart',
    })
  })

  it('keeps one durable activation request while a watcher sees the same ready target repeatedly', () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-update-restart-idempotent-'))
    roots.push(root)
    const path = join(root, 'phoenix-update-state.json')
    const target = 'f'.repeat(40)
    process.env.PHOENIX_UPDATE_SUPERVISED = '1'
    process.env.PHOENIX_AUTO_UPDATE = '1'
    process.env.PHOENIX_UPDATE_MODE = 'auto'

    writePhoenixUpdateState(path, { schema: 1, status: 'ready', target })
    const firstState = readFileSync(path, 'utf8')
    const requestPath = join(root, 'phoenix-update-restart-request.json')
    const firstRequest = readFileSync(requestPath, 'utf8')

    writePhoenixUpdateState(path, { schema: 1, status: 'ready', target })
    expect(readFileSync(path, 'utf8')).toBe(firstState)
    expect(readFileSync(requestPath, 'utf8')).toBe(firstRequest)
    const events = readFileSync(join(root, 'phoenix-update-events.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(events.filter(event => event.step === 'restarting' && event.result === 'started')).toHaveLength(1)

    writePhoenixUpdateState(path, { schema: 1, status: 'applying', target })
    writePhoenixUpdateState(path, { schema: 1, status: 'ready', target })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ status: 'applying' })

    writePhoenixUpdateState(path, { schema: 1, status: 'error', target })
    writePhoenixUpdateState(path, { schema: 1, status: 'ready', target })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ status: 'restarting' })
    expect(readFileSync(join(root, 'phoenix-update-events.jsonl'), 'utf8')
      .split('\n').filter(line => line.includes('"step":"restarting"'))).toHaveLength(2)
  })

  it('requires a healthy Host attestation before suppressing duplicate activation requests', () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-update-already-active-'))
    roots.push(root)
    const path = join(root, 'phoenix-update-state.json')
    process.env.PHOENIX_UPDATE_SUPERVISED = '1'
    process.env.PHOENIX_AUTO_UPDATE = '1'
    process.env.PHOENIX_UPDATE_MODE = 'auto'

    const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    expect(git('init').status).toBe(0)
    expect(git('config', 'user.email', 'phoenix-test@example.invalid').status).toBe(0)
    expect(git('config', 'user.name', 'Phoenix Test').status).toBe(0)
    writeFileSync(join(root, 'README.md'), 'active runtime\n', 'utf8')
    expect(git('add', 'README.md').status).toBe(0)
    expect(git('commit', '-m', 'active runtime').status).toBe(0)
    const activeTarget = git('rev-parse', 'HEAD').stdout.trim()

    writeFileSync(join(root, 'phoenix-active-runtime.json'), JSON.stringify({
      schema: 1,
      target: activeTarget,
      path: root,
    }), 'utf8')
    writeFileSync(join(root, 'phoenix-update-restart-request.json'), JSON.stringify({
      schema: 1,
      target: activeTarget,
    }), 'utf8')
    writeFileSync(join(root, 'phoenix-host-restart-request.json'), JSON.stringify({
      schema: 1,
      kind: 'host-restart',
      reason: `verified stable update ${activeTarget.slice(0, 12)} ready; activate and restart`,
    }), 'utf8')

    // Prewarm can create a candidate marker while the old Host still runs.
    // This MUST NOT be interpreted as a successfully activated update.
    writePhoenixUpdateState(path, { schema: 1, status: 'ready', target: activeTarget })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      schema: 1,
      status: 'restarting',
      target: activeTarget,
    })
    expect(existsSync(join(root, 'phoenix-update-restart-request.json'))).toBe(true)

    // Only after the actual target Host passes its stable checkpoint may the
    // supervisor attest its health and retire a stale restart request.
    writeFileSync(join(root, 'phoenix-active-runtime.json'), JSON.stringify({
      schema: 1,
      target: activeTarget,
      path: root,
      healthyAt: new Date().toISOString(),
    }), 'utf8')
    writePhoenixUpdateState(path, { schema: 1, status: 'updated', current: activeTarget, target: activeTarget })
    writePhoenixUpdateState(path, { schema: 1, status: 'ready', target: activeTarget })

    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      schema: 1,
      status: 'current',
      phase: 'idle',
      current: activeTarget,
      target: activeTarget,
    })
    expect(existsSync(join(root, 'phoenix-update-restart-request.json'))).toBe(false)
    expect(existsSync(join(root, 'phoenix-host-restart-request.json'))).toBe(false)
  })

  it('does not request an automatic restart in notify-only mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-update-notify-'))
    roots.push(root)
    const path = join(root, 'phoenix-update-state.json')
    process.env.PHOENIX_UPDATE_SUPERVISED = '1'
    process.env.PHOENIX_AUTO_UPDATE = '1'
    process.env.PHOENIX_UPDATE_MODE = 'notify'

    writePhoenixUpdateState(path, { schema: 1, status: 'ready', target: 'c'.repeat(40) })

    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      schema: 1,
      status: 'ready',
      target: 'c'.repeat(40),
    })
    expect(existsSync(join(root, 'phoenix-update-restart-request.json'))).toBe(false)
    expect(existsSync(join(root, 'phoenix-host-restart-request.json'))).toBe(false)
  })
})
