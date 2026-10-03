/** Free game-engine readiness and explicit package-manager installation; no startup work. */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const targets = new Set(['web', 'godot', 'blender', 'gameboy', 'nes', 'snes', 'genesis', 'sms', 'ps1'])
function execute(command, args, timeout = 8000) {
  return spawnSync(command, args, { encoding: 'utf8', shell: false, timeout, maxBuffer: 256 * 1024 })
}
function probe(candidates, pattern) {
  let unavailable
  for (const [command, args] of candidates) {
    const result = execute(command, args)
    if (result.error?.code === 'ENOENT') continue
    const version = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
    const resultInfo = { ready: result.status === 0 && pattern.test(version), command, version: version.slice(0, 300) }
    if (resultInfo.ready) return resultInfo
    unavailable = resultInfo
  }
  return unavailable ?? { ready: false, reason: 'Required executable is unavailable; install the selected toolchain.' }
}
function readiness(target) {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  if (target === 'web') return { ready: true, command: process.execPath, version: process.version }
  if (target === 'godot') {
    const candidates = process.env.PHOENIX_GODOT_BIN ? [[process.env.PHOENIX_GODOT_BIN, ['--version']]] : [
      ['godot', ['--version']], ['godot4', ['--version']],
      ...(process.platform === 'darwin' ? [['/Applications/Godot.app/Contents/MacOS/Godot', ['--version']]] : []),
      ...(process.platform === 'win32' && process.env.LOCALAPPDATA ? [[join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'godot.exe'), ['--version']]] : []),
      ['flatpak', ['run', 'org.godotengine.Godot', '--version']],
    ]
    return probe(candidates, /^4\.\d+(?:\.\d+)?(?:\.|\s|$)/mu)
  }
  if (target === 'blender') return probe(process.env.PHOENIX_BLENDER_BIN ? [[process.env.PHOENIX_BLENDER_BIN, ['--version']]] : [
    ['blender', ['--version']],
    ...(process.platform === 'darwin' ? [['/Applications/Blender.app/Contents/MacOS/Blender', ['--version']]] : []),
    ['flatpak', ['run', 'org.blender.Blender', '--version']],
  ], /^Blender (?:[3-9]|[1-9]\d)\./mu)
  if (target === 'gameboy') return probe([[process.env.GBDK_HOME ? join(process.env.GBDK_HOME, 'bin', `lcc${suffix}`) : 'lcc', ['-v']]], /GBDK|gbz80|sm83|SDCC/iu)
  if (target === 'nes') return probe([['cc65', ['--version']]], /cc65/iu)
  if (target === 'ps1') {
    const compiler = probe([['mipsel-none-elf-gcc', ['--version']]], /gcc/iu)
    const cmake = probe([['cmake', ['--version']]], /^cmake version/mu)
    return { ready: compiler.ready && cmake.ready, compiler, cmake, sdkLibraries: process.env.PSN00BSDK_LIBS ? 'environment configured; validate library path' : 'validate project CMake preset library path', scope: 'compiler prerequisites; SDK library/build validation still required' }
  }
  if (target === 'snes' || target === 'genesis') {
    const home = process.env[target === 'snes' ? 'PVSNESLIB_HOME' : 'GDK']
    if (!home) return { ready: false, reason: `Configure ${target === 'snes' ? 'PVSNESLIB_HOME' : 'GDK'} from the selected official SDK first.` }
    return probe([[join(home, target === 'snes' ? 'devkitsnes/bin/816-tcc' : 'bin/m68k-elf-gcc') + suffix, ['--version']]], target === 'snes' ? /tcc/iu : /gcc/iu)
  }
  return probe([['sdcc', ['--version']]], /SDCC/iu)
}
function installation(target, platform) {
  if (target !== 'godot' && target !== 'blender') throw new Error('Automatic installation supports only the free Godot and Blender engines; use the native SDK reference for other targets.')
  if (platform === 'win32') return { command: 'winget', args: ['install', '--exact', '--id', target === 'godot' ? 'GodotEngine.GodotEngine' : 'BlenderFoundation.Blender', '--source', 'winget', '--silent', '--accept-package-agreements', '--accept-source-agreements'] }
  if (platform === 'darwin') return { command: 'brew', args: ['install', '--cask', target] }
  if (platform === 'linux') return { command: 'flatpak', args: ['install', '--user', '--noninteractive', 'flathub', target === 'godot' ? 'org.godotengine.Godot' : 'org.blender.Blender'] }
  throw new Error('No verified package-manager route for this operating system.')
}
function main() {
  const [operation, ...options] = process.argv.slice(2)
  const values = {}
  for (let i = 0; i < options.length; i += 2) {
    const key = options[i]
    if (!['--target', '--platform'].includes(key) || !options[i + 1] || values[key] !== undefined) throw new Error('Use doctor|plan|install --target TARGET; --platform is allowed only for plan.')
    values[key] = options[i + 1]
  }
  const target = values['--target']
  if (!targets.has(target)) throw new Error('Unknown game target.')
  if (operation !== 'plan' && values['--platform']) throw new Error('Actual probes/installations always use the current operating system.')
  if (operation === 'doctor') {
    const result = readiness(target)
    console.log(JSON.stringify({ target, ...result }))
    process.exitCode = result.ready ? 0 : 1
    return
  }
  if (operation !== 'plan' && operation !== 'install') throw new Error('Unknown game-tool operation.')
  const platform = values['--platform'] ?? process.platform
  const plan = installation(target, platform)
  if (operation === 'plan') { console.log(JSON.stringify({ target, platform, ...plan })); return }
  const before = readiness(target)
  if (before.ready) { console.log(JSON.stringify({ target, ...before, installed: false })); return }
  const result = execute(plan.command, plan.args, 600_000)
  if (result.status !== 0) throw new Error(`Package-manager installation failed (${result.error?.code ?? result.status}); inspect the official manager and its prerequisites. No ready state is claimed.`)
  const after = readiness(target)
  console.log(JSON.stringify({ target, ...after, installed: true }))
  process.exitCode = after.ready ? 0 : 1
}
try { main() } catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 2
}
