from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


updater = 'scripts/phoenix-auto-update.mjs'
replace_once(
    updater,
    "    status: 'available',\n    phase: 'worktree',\n    ...updateFacts(inspection),\n    detail: `Stable update ${inspection.target.slice(0, 12)} is prepared in isolated staging (${plan.mode}); local changes remain protected; activation waits for a clean checkout.`,",
    "    status: 'ready',\n    phase: 'runtime',\n    ...updateFacts(inspection),\n    detail: `Stable update ${inspection.target.slice(0, 12)} is prepared in isolated staging (${plan.mode}); local changes remain protected; restart to activate the verified isolated runtime.`,",
    'updater prepared state',
)
replace_once(
    updater,
    "      console.error(`[PHOENIX UPDATE] stable ${target.slice(0, 12)} is prepared in isolated staging; local changes remain protected. Clean the checkout before activation.`)",
    "      console.error(`[PHOENIX UPDATE] stable ${target.slice(0, 12)} is prepared in isolated staging; local changes remain protected; restart to activate the verified isolated runtime.`)",
    'updater dirty prepared message',
)

supervisor = 'scripts/phoenix-windows-supervisor.mjs'
replace_once(
    supervisor,
    "const root = resolve(process.cwd())\nconst hostArgs = process.argv.slice(2)",
    "const root = resolve(process.cwd())\nlet runtimeRoot = root\nconst hostArgs = process.argv.slice(2)",
    'supervisor runtime root',
)
replace_once(
    supervisor,
    "const RESTART_REQUEST_FILE = 'phoenix-update-restart-request.json'\nconst HOST_RESTART_REQUEST_FILE = 'phoenix-host-restart-request.json'",
    "const RESTART_REQUEST_FILE = 'phoenix-update-restart-request.json'\nconst PREPARED_FILE = 'phoenix-update-prepared.json'\nconst ACTIVE_RUNTIME_FILE = 'phoenix-active-runtime.json'\nconst HOST_RESTART_REQUEST_FILE = 'phoenix-host-restart-request.json'",
    'supervisor runtime constants',
)

marker = "function restartRequestPath() {\n  return gitControlPath(RESTART_REQUEST_FILE)\n}\n"
runtime_helpers = r'''function preparedPath() {
  return gitControlPath(PREPARED_FILE)
}

function activeRuntimePath() {
  return gitControlPath(ACTIVE_RUNTIME_FILE)
}

function readPreparedRecord() {
  const path = preparedPath()
  if (path === undefined || !existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schema !== 1 || typeof value.target !== 'string' || !/^[0-9a-f]{40}$/iu.test(value.target)) return undefined
    return value
  } catch {
    return undefined
  }
}

function runtimeBaseDirectory() {
  const configured = process.env.PHOENIX_UPDATE_TEMP?.trim()
  const base = configured !== undefined && configured.length > 0
    ? resolve(configured)
    : join(homedir(), 'p')
  mkdirSync(base, { recursive: true })
  return base
}

function persistentRuntime(target) {
  return join(runtimeBaseDirectory(), `phoenix-runtime-${target.slice(0, 12)}`)
}

function runChecked(cwd, bin, args, label) {
  const result = spawnSync(bin, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    windowsHide: false,
  })
  if (result.error !== undefined) throw new Error(`${label}: ${result.error.message}`)
  if ((result.status ?? 1) !== 0) throw new Error(`${label} exited with ${String(result.status ?? 1)}`)
}

function runPnpm(cwd, args, label) {
  const commandProcessor = process.env.ComSpec ?? 'cmd.exe'
  const pnpmCommand = process.env.PHOENIX_PNPM?.trim() || 'corepack pnpm'
  const commandLine = `${pnpmCommand} ${args.join(' ')}`
  runChecked(cwd, commandProcessor, ['/d', '/s', '/c', commandLine], label)
}

function preparedStageForTarget(target) {
  const prepared = readPreparedRecord()
  if (prepared?.target !== target) return undefined
  const stage = persistentStage()
  if (!sameRepository(stage) || !gitClean(stage)) return undefined
  if (gitValue(stage, ['rev-parse', 'HEAD']) !== target) return undefined
  if (!existsSync(join(stage, 'apps', 'cli', 'lib', 'bin.js'))) return undefined
  return stage
}

function runtimeIsHealthy(path, target) {
  return existsSync(path)
    && sameRepository(path)
    && gitClean(path)
    && gitValue(path, ['rev-parse', 'HEAD']) === target
    && existsSync(join(path, 'apps', 'cli', 'lib', 'bin.js'))
}

function writeActiveRuntime(target, path) {
  const markerPath = activeRuntimePath()
  if (markerPath === undefined) throw new Error('could not resolve active runtime marker path')
  writeFileSync(markerPath, JSON.stringify({
    schema: 1,
    target,
    path,
    activatedAt: new Date().toISOString(),
  }, undefined, 2) + '\n', 'utf8')
}

function clearActiveRuntime() {
  const path = activeRuntimePath()
  if (path === undefined) return
  try {
    unlinkSync(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`[PHOENIX UPDATE] warning: could not clear active runtime marker: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function activatePreparedRuntime(target) {
  const stage = preparedStageForTarget(target)
  if (stage === undefined) throw new Error(`prepared staging candidate ${target.slice(0, 12)} is missing or no longer valid`)

  const runtime = persistentRuntime(target)
  if (existsSync(runtime) && !sameRepository(runtime)) {
    throw new Error(`PHOENIX runtime path exists but is not this repository: ${runtime}`)
  }

  if (!runtimeIsHealthy(runtime, target)) {
    if (!existsSync(runtime)) {
      runChecked(root, 'git', ['worktree', 'add', '--detach', '--force', runtime, target], 'create isolated runtime worktree')
    }
    runChecked(runtime, 'git', ['reset', '--hard', target], 'reset isolated runtime')
    runChecked(runtime, 'git', ['clean', '-fd'], 'clean isolated runtime')
    runPnpm(runtime, ['install', '--frozen-lockfile'], 'install isolated runtime dependencies')
    runPnpm(runtime, ['run', 'build'], 'build isolated runtime')
    runChecked(runtime, process.execPath, [join(runtime, 'apps', 'cli', 'lib', 'bin.js'), '--version'], 'smoke-test isolated runtime')
  }

  if (!runtimeIsHealthy(runtime, target)) {
    throw new Error(`isolated runtime ${target.slice(0, 12)} failed post-build validation`)
  }
  writeActiveRuntime(target, runtime)
  return { target, path: runtime }
}

function restoreActiveRuntime() {
  const markerPath = activeRuntimePath()
  if (markerPath === undefined || !existsSync(markerPath)) return
  try {
    const value = JSON.parse(readFileSync(markerPath, 'utf8'))
    if (value?.schema !== 1 || typeof value.target !== 'string' || !/^[0-9a-f]{40}$/iu.test(value.target) || typeof value.path !== 'string') {
      clearActiveRuntime()
      return
    }
    const candidate = resolve(value.path)
    if (!runtimeIsHealthy(candidate, value.target)) {
      clearActiveRuntime()
      return
    }
    runtimeRoot = candidate
    console.error(`[PHOENIX UPDATE] restored verified isolated runtime ${value.target.slice(0, 12)}; source checkout remains untouched.`)
  } catch {
    clearActiveRuntime()
  }
}

'''
replace_once(supervisor, marker, runtime_helpers + marker, 'supervisor runtime helpers')

replace_once(
    supervisor,
    "    cwd: root,\n    env: {\n      ...hydratePhoenixEnvironment(process.env),\n      PHOENIX_UPDATE_SUPERVISED: '1',\n      PHOENIX_CONFIG_PREFLIGHT: '1',",
    "    cwd: runtimeRoot,\n    env: {\n      ...hydratePhoenixEnvironment(process.env),\n      PHOENIX_RUNTIME_ROOT: runtimeRoot,\n      PHOENIX_UPDATE_SUPERVISED: '1',\n      PHOENIX_CONFIG_PREFLIGHT: '1',",
    'supervisor preflight runtime cwd',
)
replace_once(
    supervisor,
    "    cwd: root,\n    stdio: 'inherit',\n    windowsHide: false,\n    env: {\n      ...hydratePhoenixEnvironment(process.env),\n      PHOENIX_UPDATE_SUPERVISED: '1',",
    "    cwd: runtimeRoot,\n    stdio: 'inherit',\n    windowsHide: false,\n    env: {\n      ...hydratePhoenixEnvironment(process.env),\n      PHOENIX_RUNTIME_ROOT: runtimeRoot,\n      PHOENIX_UPDATE_SUPERVISED: '1',",
    'supervisor host runtime cwd',
)
replace_once(
    supervisor,
    "  const startupStatus = gitStatus(root)\n  if (!startupStatus.ok || startupStatus.entries.length > 0) {\n    const detail = startupStatus.ok\n      ? `${String(startupStatus.entries.length)} local change(s) detected`\n      : 'Git worktree status could not be verified'\n    console.error(`[PHOENIX UPDATE] ${detail}; automatic update watcher paused for this session. PHOENIX will start normally.`)\n    return undefined\n  }\n\n",
    "",
    'supervisor dirty watcher pause',
)
replace_once(
    supervisor,
    "recoverStaleStagingIndexLock()\nrecoverConfigurationBeforeFirstBoot()",
    "recoverStaleStagingIndexLock()\nrestoreActiveRuntime()\nrecoverConfigurationBeforeFirstBoot()",
    'supervisor active runtime restore',
)

p = Path(supervisor)
text = p.read_text(encoding='utf-8')
start_marker = "  const requested = restartRequested()\n"
end_marker = "\n  if (plannedHostRestart) continue"
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit(f'supervisor restart block markers missing: start={start}, end={end}')
new_restart = '''  const requestedTarget = restartRequestTarget()
  if (requestedTarget !== undefined) {
    const liveStatus = gitStatus(root)
    if (!liveStatus.ok) {
      clearRestartRequest()
      reportDirtyActivationBlock(liveStatus)
      continue
    }

    if (liveStatus.entries.length > 0) {
      console.error('[PHOENIX UPDATE] local changes detected; activating the verified update in an isolated runtime; the live checkout will not be modified.')
      try {
        const runtime = activatePreparedRuntime(requestedTarget)
        runtimeRoot = runtime.path
        clearRestartRequest()
        console.error(`[PHOENIX UPDATE] isolated runtime ${runtime.target.slice(0, 12)} activated; relaunching PHOENIX without touching local changes.`)
      } catch (error) {
        clearRestartRequest()
        console.error(`[PHOENIX UPDATE] isolated runtime activation failed safely: ${error instanceof Error ? error.message : String(error)}`)
      }
      continue
    }

    console.error('[PHOENIX UPDATE] restart request received; activating prepared update under supervisor control...')
    const activationCode = activatePrepared()
    if (activationCode !== 0) {
      clearRestartRequest()
      if (activationCode === 12) {
        console.error('[PHOENIX UPDATE] rollback failed critically; refusing automatic relaunch from an unknown checkout state.')
        finalCode = activationCode
        break
      }
      console.error(`[PHOENIX UPDATE] activation failed safely with exit code ${String(activationCode)}; relaunching the last-known-good PHOENIX. The prepared update remains available to retry.`)
      continue
    }

    runtimeRoot = root
    clearActiveRuntime()
    console.error('[PHOENIX UPDATE] activation succeeded; relaunching PHOENIX now...')
    continue
  }
'''
p.write_text(text[:start] + new_restart + text[end:], encoding='utf-8')

print('dirty runtime updater patch applied')
