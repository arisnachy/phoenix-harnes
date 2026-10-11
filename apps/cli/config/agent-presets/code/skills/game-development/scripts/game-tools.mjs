/** On-demand game toolchains: route -> doctor -> ensure; never install at startup. */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const targets = new Set(['web', 'godot', 'blender', 'tiled', 'ffmpeg', 'gameboy', 'nes', 'snes', 'genesis', 'sms', 'ps1'])
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
  if (target === 'tiled') {
    return probe(process.env.PHOENIX_TILED_BIN ? [[process.env.PHOENIX_TILED_BIN, ['--version']]] : [
      ['tiled', ['--version']],
      ...(process.platform === 'darwin'
        ? [['/Applications/Tiled.app/Contents/MacOS/Tiled', ['--version']]] : []),
      ...(process.platform === 'win32' && process.env.ProgramFiles
        ? [[join(process.env.ProgramFiles, 'Tiled', 'tiled.exe'), ['--version']]] : []),
    ], /^(?:Tiled\s+)?\d+\.\d+(?:\.\d+)?(?:\.|\s|$)/mu)
  }
  if (target === 'ffmpeg') return probe(process.env.PHOENIX_FFMPEG_BIN
    ? [[process.env.PHOENIX_FFMPEG_BIN, ['-version']]]
    : [['ffmpeg', ['-version']]], /^ffmpeg version\s+\S+/mu)
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
/**
 * Routing is a deterministic, read-only decision based on the *delivery target*.
 * Godot's multi-file HTML5 WebAssembly export is NOT a valid single-file
 * phoenix_game payload. A Godot project can still be delivered separately.
 */
function route(genre, delivery, quality) {
  if (!['chat', 'desktop', 'web'].includes(delivery)) throw new Error('Delivery must be chat, desktop or web.')
  if (!['prototype', 'production'].includes(quality)) throw new Error('Quality must be prototype or production.')
  if (!genre.trim()) throw new Error('Genre cannot be empty.')
  const normalized = genre.toLowerCase()
  const brawler = /beat.em.up|beat.?em.?up|double.dragon|brawler|street.fight/u.test(normalized)
  const is3d = /3d|open.world|mundo.abierto|low.poly|racing.3d/u.test(normalized)
  const simple = /snake|pong|tetris|2048|logic.puzzle|juego.de.tablero/u.test(normalized)
  const complexity = brawler || is3d || (!simple && quality === 'production')
  const engine = delivery === 'chat' || !complexity ? 'html5' : 'godot'
  const tools = engine === 'godot'
    ? ['godot', ...(is3d ? ['blender'] : ['tiled']), 'ffmpeg']
    : (simple ? [] : ['tiled', 'ffmpeg'])
  return {
    genre, delivery, quality, engine, tools,
    action: tools.length ? 'Run doctor for each tool; ensure missing tools only during an authorized game build.' : 'No external editor is required.',
    renderer: delivery === 'chat' ? 'phoenix_game-single-file-html' : 'native-project-or-hosted-export',
    godotWebNote: delivery === 'web' && engine === 'godot'
      ? 'Godot HTML5 export requires matching templates, JS/WASM/PCK files and real HTTP hosting; never present its index.html alone as an in-chat game.'
      : undefined,
    gate: 'Presets require imported atlas/scene IDs, visible runtime animation, original audio and real playtest evidence.',
  }
}

function installation(target, platform) {
  const packages = {
    godot: { win32: 'GodotEngine.GodotEngine', darwin: 'godot', linux: 'org.godotengine.Godot' },
    blender: { win32: 'BlenderFoundation.Blender', darwin: 'blender', linux: 'org.blender.Blender' },
    tiled: { win32: 'Tiled.Tiled', darwin: 'tiled' },
    ffmpeg: { win32: 'Gyan.FFmpeg', darwin: 'ffmpeg' },
  }
  if (!(target in packages)) throw new Error('No approved automatic installation route for this target.')
  const id = packages[target][platform]
  if (!id) throw new Error('No verified package manager route for ' + target + ' on ' + platform + '.')
  if (platform === 'win32') return {
    command: 'winget',
    args: ['install', '--exact', '--id', id, '--source', 'winget', '--silent',
      '--accept-package-agreements', '--accept-source-agreements'],
  }
  if (platform === 'darwin') return {
    command: 'brew', args: ['install', ...(target === 'ffmpeg' ? [] : ['--cask']), id],
  }
  if (platform === 'linux') return {
    command: 'flatpak', args: ['install', '--user', '--noninteractive', 'flathub', id],
  }
  throw new Error('No verified package manager route for this operating system.')
}
function main() {
  const [operation, ...options] = process.argv.slice(2)
  const values = {}
  for (let i = 0; i < options.length; i += 2) {
    const key = options[i]
    if (!['--target', '--platform', '--genre', '--delivery', '--quality'].includes(key)
      || !options[i + 1] || values[key] !== undefined) {
      throw new Error('Use route --genre NAME --delivery chat|desktop|web --quality production|prototype or doctor|plan|ensure --target TARGET.')
    }
    values[key] = options[i + 1]
  }
  if (operation === 'route') {
    if (values['--target'] || values['--platform']) throw new Error('Route only supports genre, delivery and quality.')
    console.log(JSON.stringify(route(values['--genre'] ?? '',
      values['--delivery'] ?? 'chat', values['--quality'] ?? 'production')))
    return
  }
  if (values['--genre'] || values['--delivery'] || values['--quality']) {
    throw new Error('Routing options are only allowed for route.')
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
  if (operation !== 'plan' && operation !== 'install' && operation !== 'ensure') throw new Error('Unknown game-tool operation.')
  const platform = values['--platform'] ?? process.platform
  if (operation === 'plan') {
    const plan = installation(target, platform)
    console.log(JSON.stringify({ target, platform, ...plan }))
    return
  }
  const before = readiness(target)
  if (before.ready) {
    console.log(JSON.stringify({ target, ...before, installed: false, action: 'reused-existing' }))
    return
  }
  // The user must have authorized toolchain provisioning in the active game mission.
  // Allowlisted package IDs + no shell + current OS protect against model-supplied commands.
  const plan = installation(target, platform)
  const result = execute(plan.command, plan.args, 600_000)
  if (result.status !== 0) {
    throw new Error(`Package-manager installation failed (${result.error?.code ?? result.status}); check the verified manager/installation logs. No ready state is claimed.`)
  }
  const after = readiness(target)
  console.log(JSON.stringify({ target, ...after, installed: true,
    action: after.ready ? 'installed-and-verified' : 'installed-but-not-detected',
    reason: after.ready ? undefined : 'Reopen the terminal or configure the PHOENIX_*_BIN executable path, then run doctor again.' }))
  process.exitCode = after.ready ? 0 : 1
}
try { main() } catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 2
}
