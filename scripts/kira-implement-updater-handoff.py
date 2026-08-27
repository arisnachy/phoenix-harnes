from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'expected pattern missing in {path}: {old[:120]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'expected one pattern in {path}, got {text.count(old)}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


updater = ROOT / 'scripts/phoenix-auto-update.mjs'
supervisor = ROOT / 'scripts/phoenix-windows-supervisor.mjs'
bin_ts = ROOT / 'apps/cli/src/bin.ts'

# 1. Updater: the staging worker requests activation only after build/smoke succeeded.
replace_once(
    updater,
    "function restartRequestPath(root) {\n  return join(gitDirectory(root), RESTART_REQUEST_FILE)\n}\n",
    "function restartRequestPath(root) {\n  return join(gitDirectory(root), RESTART_REQUEST_FILE)\n}\n\nfunction writeRestartRequest(root, target) {\n  writeFileSync(restartRequestPath(root), `${JSON.stringify({\n    schema: 1,\n    target,\n    requestedAt: new Date().toISOString(),\n  }, null, 2)}\\n`, 'utf8')\n}\n",
)
replace_once(
    updater,
    "    console.error(`[PHOENIX UPDATE] stable ${target.slice(0, 12)} is prepared (${plan.mode}). Restart PHOENIX to activate it.`)\n",
    "    console.error(`[PHOENIX UPDATE] stable ${target.slice(0, 12)} is prepared (${plan.mode}).`)\n",
)
replace_once(
    updater,
    "            stageCandidate(root, inspection)\n            preparedTarget = inspection.target\n",
    "            stageCandidate(root, inspection)\n            preparedTarget = inspection.target\n            if (process.env.PHOENIX_UPDATE_SUPERVISED === '1') {\n              writeRestartRequest(root, inspection.target)\n              writeState(root, { status: 'restart-requested', phase: 'restart', ...updateFacts(inspection) })\n              console.error(`[PHOENIX UPDATE] stable ${inspection.target.slice(0, 12)} passed preflight; requesting supervised activation.`)\n            }\n",
)

# 2. Host launcher: supervised hosts never create a second updater watcher.
replace_once(
    bin_ts,
    "    startPhoenixUpdateWatcher()\n",
    "    if (process.env.PHOENIX_UPDATE_SUPERVISED !== '1') startPhoenixUpdateWatcher()\n",
)

# 3. Supervisor: mark both child processes as supervised and race Host exit against restart request.
replace_once(
    supervisor,
    "    env: process.env,\n  })\n}\n\nfunction startWatcher()",
    "    env: { ...process.env, PHOENIX_UPDATE_SUPERVISED: '1' },\n  })\n}\n\nfunction startWatcher()",
)
replace_once(
    supervisor,
    "  const watcherEnv = {\n    ...process.env,\n",
    "  const watcherEnv = {\n    ...process.env,\n    PHOENIX_UPDATE_SUPERVISED: '1',\n",
)

anchor = "const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))\n\nasync function stopWatcher(watcher) {"
replacement = """const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

async function waitForHostEvent(host) {
  return await new Promise(resolveEvent => {
    let settled = false
    const finish = (event) => {
      if (settled) return
      settled = true
      clearInterval(timer)
      resolveEvent(event)
    }
    const timer = setInterval(() => {
      if (restartRequested()) finish({ kind: 'restart' })
    }, 200)
    timer.unref?.()
    host.once('exit', (code, signal) => finish({ kind: 'exit', code, signal }))
  })
}

async function stopHost(host) {
  if (host.exitCode !== null || host.signalCode !== null) return
  const exited = new Promise(resolveExit => host.once('exit', resolveExit))
  try {
    host.kill('SIGTERM')
  } catch {}
  await Promise.race([exited, sleep(2500)])
  if (host.exitCode === null && host.signalCode === null && host.pid !== undefined) {
    spawnSync('taskkill', ['/PID', String(host.pid), '/T', '/F'], {
      cwd: root,
      windowsHide: true,
      stdio: 'ignore',
    })
    await Promise.race([exited, sleep(1500)])
  }
}

async function stopWatcher(watcher) {"""
replace_once(supervisor, anchor, replacement)

old_loop = """  const hostExit = await new Promise(resolveExit => {
    host.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  const requested = restartRequested()

  await stopWatcher(watcher)

  if (!requested) {
    finalCode = hostExit.code ?? (hostExit.signal === null ? 1 : 0)
    break
  }

  console.error('[PHOENIX UPDATE] restart request received; activating prepared update under supervisor control...')
"""
new_loop = """  const event = await waitForHostEvent(host)
  const requested = event.kind === 'restart' || restartRequested()

  if (requested && event.kind === 'restart') {
    console.error('[PHOENIX UPDATE] prepared update requested activation; stopping the current Host...')
    await stopHost(host)
  }
  await stopWatcher(watcher)

  if (!requested) {
    finalCode = event.kind === 'exit'
      ? event.code ?? (event.signal === null ? 1 : 0)
      : 1
    break
  }

  console.error('[PHOENIX UPDATE] restart request received; activating prepared update under supervisor control...')
"""
replace_once(supervisor, old_loop, new_loop)

# Persistent contract test: deliberately source-level for the process ownership invariants,
# plus updater self-test execution in CI. It prevents the exact regression without needing
# to spawn a real browser Host inside a unit test.
test = ROOT / 'scripts/phoenix-update-supervision-contract.mjs'
test.write_text("""#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const updater = readFileSync(resolve(root, 'scripts/phoenix-auto-update.mjs'), 'utf8')
const supervisor = readFileSync(resolve(root, 'scripts/phoenix-windows-supervisor.mjs'), 'utf8')
const cli = readFileSync(resolve(root, 'apps/cli/src/bin.ts'), 'utf8')

function must(value, message) {
  if (!value) throw new Error(message)
}

must(!updater.includes('Restart PHOENIX to activate it'), 'legacy manual-restart message must be absent')
must(updater.includes("PHOENIX_UPDATE_SUPERVISED === '1'"), 'watcher must recognize supervised ownership')
must(updater.includes('writeRestartRequest(root, inspection.target)'), 'successful watched preparation must request restart')
must(updater.indexOf('stageCandidate(root, inspection)') < updater.indexOf('writeRestartRequest(root, inspection.target)'), 'restart request must follow candidate staging')
must(cli.includes("PHOENIX_UPDATE_SUPERVISED !== '1'"), 'supervised Host must suppress its duplicate watcher')
must(supervisor.includes("PHOENIX_UPDATE_SUPERVISED: '1'"), 'supervisor must mark child Host/watcher ownership')
must(supervisor.includes('waitForHostEvent(host)'), 'supervisor must observe restart while Host is alive')
must(supervisor.includes("host.kill('SIGTERM')"), 'supervisor must request Host termination before activation')
must(supervisor.indexOf('await stopHost(host)') < supervisor.indexOf('const activationCode = activatePrepared()'), 'Host must stop before activation')
console.log('PHOENIX supervised updater contract: PASS')
""", encoding='utf-8')

# Remove implementation/scout scaffolding in the commit produced by the workflow.
for temporary in [
    ROOT / '.github/workflows/kira-surfacehost-scout.yml',
    ROOT / '.github/workflows/kira-implement-updater-handoff.yml',
    ROOT / 'scripts/kira-implement-updater-handoff.py',
]:
    if temporary.exists():
        temporary.unlink()

print('updater supervised handoff patch applied')
