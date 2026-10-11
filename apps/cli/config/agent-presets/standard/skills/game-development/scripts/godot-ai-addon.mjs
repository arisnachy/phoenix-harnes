/**
 * Godot AI v4.3.0 addon installer for *new* Godot projects. Never silently
 * overwrite an installed addon or interrupt v3->v4 signed migration.
 *
 * node godot-ai-addon.mjs plan --project PATH
 * node godot-ai-addon.mjs doctor --project PATH
 * node godot-ai-addon.mjs install --project PATH --allow-install
 *
 * This deliberately does not claim the editor plugin or MCP link is running.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const VERSION = 'v4.3.0'
const RELEASE = 'https://github.com/hi-godot/godot-ai/releases/download/v4.3.0/godot-ai-v4-plugin.zip'
const SHA256 = 'dbc3d16e1aa7a5f3ae8038a150bf4191162112f4329c79611aa6f656e3ca4e58'
const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024
const [operation = 'plan', ...args] = process.argv.slice(2)
let project
let grant = false
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project' && typeof args[i + 1] === 'string' && project === undefined) {
    project = resolve(args[++i])
  } else if (args[i] === '--allow-install' && !grant) {
    grant = true
  } else throw new Error('Use plan|doctor|install --project EXISTING_GODOT_PROJECT [--allow-install].')
}
if (!['plan', 'doctor', 'install'].includes(operation) || !project) {
  throw new Error('Use plan|doctor|install --project EXISTING_GODOT_PROJECT.')
}
if (grant && operation !== 'install') throw new Error('--allow-install only applies to install.')
const projectFile = join(project, 'project.godot')
if (!existsSync(projectFile)) throw new Error('The selected directory has no project.godot.')
const addon = join(project, 'addons', 'godot_ai')
const cfg = join(addon, 'plugin.cfg')
const pending = join(project, 'addons', '.godot_ai_update', 'pending.json')
const announce = (data) => process.stdout.write(JSON.stringify(data) + '\n')
const existing = existsSync(addon)
const state = existsSync(pending) ? 'migration-pending'
  : existing ? (existsSync(cfg) ? 'installed-version-unverified' : 'incomplete-existing-addon') : 'missing'
const plan = {
  action: operation, project, addon, state, pinnedRelease: VERSION, packageUrl: RELEASE,
  sha256: SHA256, installationAllowed: false,
}
if (operation === 'plan') {
  announce({ ...plan, note: 'Downloads and verifies the official release ZIP on explicit install only. No update/overwrite/migration.' })
} else if (operation === 'doctor') {
  announce({ action: 'doctor', state, addonPresent: existsSync(cfg),
    next: existing ? 'Use the Godot AI dock for signed updates or v3-to-v4 migration.'
      : 'Install this pinned release, enable the plugin in Godot, then configure DeepSeek Harness in the dock.' })
  process.exitCode = state === 'installed-version-unverified' ? 0 : 1
} else if (existing || existsSync(pending)) {
  throw new Error('Existing Godot AI addon/migration must be managed by its own signed updater. Refusing overwrite.')
} else if (!grant) {
  announce({ ...plan, next: 'Request permission before using install --allow-install.' })
  process.exitCode = 1
} else {
  const dir = mkdtempSync(join(tmpdir(), 'phoenix-godot-ai-'))
  const archive = join(dir, 'addon.zip')
  const stage = join(dir, 'stage')
  try {
    // The upstream asset may redirect to GitHub's trusted release CDN;
    // the pinned digest authenticates the bytes independently of TLS.
    const response = await fetch(RELEASE, { signal: AbortSignal.timeout(45_000) })
    if (!response.ok) throw new Error('Official Godot AI release download failed: ' + response.status)
    const advertised = Number(response.headers.get('content-length') ?? 0)
    if (advertised > MAX_DOWNLOAD_BYTES) throw new Error('Release package exceeds download limit.')
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length > MAX_DOWNLOAD_BYTES) throw new Error('Release package exceeds download limit.')
    const digest = createHash('sha256').update(body).digest('hex')
    if (digest !== SHA256) throw new Error('Official Godot AI release SHA-256 mismatch. Refusing archive.')
    writeFileSync(archive, body, { mode: 0o600, flag: 'wx' })
    mkdirSync(stage)
    // Standard library Python performs traversal/symlink/bomb validation
    // before extracting *only* the addon's actual files into a private stage.
    const py = String.raw`import pathlib, shutil, stat, sys, zipfile
archive, root = sys.argv[1:]
with zipfile.ZipFile(archive) as z:
    entries = z.infolist()
    prefixes = {item.filename[:-len("plugin.cfg")] for item in entries
                if item.filename.replace("\\", "/").endswith("addons/godot_ai/plugin.cfg")}
    if len(prefixes) != 1:
        raise RuntimeError("Expected exactly one addons/godot_ai/plugin.cfg in official archive")
    prefix = prefixes.pop()
    chosen = [i for i in entries if i.filename.startswith(prefix)]
    if len(chosen) > 600 or sum(i.file_size for i in chosen) > 25_000_000:
        raise RuntimeError("Archive exceeds safe asset budget")
    if not chosen:
        raise RuntimeError("Empty addon")
    for item in chosen:
        rel = item.filename[len(prefix):].replace("\\", "/")
        path = pathlib.PurePosixPath(rel)
        if not rel or item.is_dir():
            continue
        if path.is_absolute() or ".." in path.parts or "." in path.parts:
            raise RuntimeError("Unsafe archive path")
        mode = (item.external_attr >> 16) & 0o170000
        if mode not in (0, stat.S_IFREG):
            raise RuntimeError("Links and special files are disallowed")
        target = pathlib.Path(root).joinpath(*path.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        with z.open(item) as source, target.open("xb") as out:
            shutil.copyfileobj(source, out)
if not (pathlib.Path(root) / "plugin.cfg").is_file():
    raise RuntimeError("Missing plugin.cfg after extraction")
`;
    const python = process.env.PHOENIX_PYTHON_BIN ?? (process.platform === 'win32' ? 'py' : 'python3')
    const prefixArgs = python === 'py' ? ['-3'] : []
    const result = spawnSync(python, [...prefixArgs, '-c', py, archive, stage], {
      encoding: 'utf8', shell: false, timeout: 30_000, maxBuffer: 4096,
    })
    if (result.status !== 0) {
      throw new Error('Safe addon extraction failed; configure Python 3. ' + String(result.stderr || result.error || '').slice(0, 250))
    }
    if (!existsSync(join(stage, 'plugin.cfg'))) throw new Error('Downloaded package lacks the Godot AI plugin entry.')
    mkdirSync(dirname(addon), { recursive: true })
    if (existsSync(addon) || existsSync(pending)) throw new Error('Addon appeared during download; not overwriting it.')
    renameSync(stage, addon)
    announce({ action: 'install', state: 'installed-not-enabled', addon, release: VERSION,
      verifiedSha256: digest, next: 'Enable Godot AI in Project Settings > Plugins, configure DeepSeek Harness in the Godot AI dock, then run godot-ai-bridge sync.' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
