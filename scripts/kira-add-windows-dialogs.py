from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / 'packages/windows/tool-windows-dialogs'
(PKG / 'src').mkdir(parents=True, exist_ok=True)
(PKG / 'tests').mkdir(parents=True, exist_ok=True)

package = {
  'name': '@deepseek-ai/dsh-tool-windows-dialogs',
  'description': 'Semantic Windows native dialog automation behind PHOENIX HARDNESS policy',
  'version': '0.1.1-rc.2',
  'publishConfig': {'access': 'public'},
  'repository': {'type': 'git', 'url': 'git+https://github.com/deepseek-ai/deepseek-harness.git', 'directory': 'packages/windows/tool-windows-dialogs'},
  'type': 'module',
  'main': 'lib/index.js',
  'types': 'lib/types/index.d.ts',
  'exports': {
    '.': {'types': './lib/types/index.d.ts', 'default': './lib/index.js'},
    './invariant': {'types': './lib/types/invariant.d.ts', 'default': './lib/invariant.js'},
    './src/*': './src/*', './package.json': './package.json'
  },
  'files': ['lib/index.js', 'lib/invariant.js', 'lib/types/**/*.d.ts'],
  'license': 'MIT',
  'peerDependencies': {
    '@deepseek-ai/dsh-agent': 'workspace:^', '@deepseek-ai/dsh-invariants': 'workspace:^',
    '@deepseek-ai/dsh-sandbox': 'workspace:^', '@deepseek-ai/dsh-sandbox-policy': 'workspace:^',
    '@deepseek-ai/dsh-system-prompt': 'workspace:^', '@deepseek-ai/dsh-tools': 'workspace:^',
    '@deepseek-ai/cordis': 'workspace:^'
  },
  'dependencies': {'@deepseek-ai/schemastery': 'workspace:^'},
  'devDependencies': {
    '@deepseek-ai/dsh-agent': 'workspace:^', '@deepseek-ai/dsh-invariants': 'workspace:^',
    '@deepseek-ai/dsh-sandbox': 'workspace:^', '@deepseek-ai/dsh-sandbox-policy': 'workspace:^',
    '@deepseek-ai/dsh-system-prompt': 'workspace:^', '@deepseek-ai/dsh-tools': 'workspace:^',
    '@deepseek-ai/cordis': 'workspace:^', 'vitest': '^3.2.4'
  }
}
(PKG / 'package.json').write_text(json.dumps(package, indent=2) + '\n', encoding='utf-8')

(PKG / 'tsconfig.json').write_text('''{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"],
  "references": [
    { "path": "../../../vendor/cordis" },
    { "path": "../../../vendor/schemastery" },
    { "path": "../../core/tools" },
    { "path": "../../core/agent" },
    { "path": "../../core/system-prompt" },
    { "path": "../../sandbox/sandbox" },
    { "path": "../../sandbox/sandbox-policy" },
    { "path": "../../runtime-diagnostics/invariants" }
  ]
}
''', encoding='utf-8')
(PKG / 'tsdown.config.ts').write_text("import { defineConfig } from 'tsdown'\nexport default defineConfig({ entry: ['src/index.ts', 'src/invariant.ts'], format: 'esm', dts: false, clean: true })\n", encoding='utf-8')

(PKG / 'src/invariant.ts').write_text('''import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-tool-windows-dialogs'
export const name = 'tool-windows-dialogs-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
''', encoding='utf-8')

(PKG / 'src/policy.ts').write_text(r'''import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'

export type NativePathOperation = 'open' | 'save'

function sameOrUnder(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  if (process.platform === 'win32') {
    const folded = rel.toLowerCase()
    return folded === '' || (folded !== '..' && !folded.startsWith(`..${sep}`) && !isAbsolute(rel))
  }
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export function assertNativeDialogPathAllowed(
  policy: SandboxExecutionPolicy,
  candidate: string,
  operation: NativePathOperation,
): string {
  const resolved = resolve(candidate)
  if (policy.mode === 'danger-full-access') return resolved
  if (operation === 'save' && policy.mode === 'read-only') {
    throw new Error('Windows dialog save denied by PHOENIX read-only policy')
  }
  if (!sameOrUnder(policy.workspaceRoot, resolved)) {
    throw new Error(`Windows dialog path denied outside PHOENIX workspace: ${resolved}`)
  }
  return resolved
}
''', encoding='utf-8')

(PKG / 'src/classify.ts').write_text(r'''export type WindowsDialogKind = 'open-file' | 'save-file' | 'folder-picker' | 'confirmation' | 'unknown'

export function classifyDialogTitle(title: string, buttonNames: readonly string[] = []): WindowsDialogKind {
  const value = title.trim().toLowerCase()
  if (/\b(save as|save file|guardar como|guardar archivo)\b/u.test(value)) return 'save-file'
  if (/\b(open|open file|abrir|abrir archivo|choose file|seleccionar archivo)\b/u.test(value)) return 'open-file'
  if (/\b(select folder|choose folder|browse for folder|seleccionar carpeta|elegir carpeta)\b/u.test(value)) return 'folder-picker'
  const buttons = buttonNames.map(name => name.trim().toLowerCase())
  if (buttons.some(name => ['yes', 'no', 'ok', 'cancel', 'sí', 'si', 'no', 'aceptar', 'cancelar'].includes(name))) return 'confirmation'
  return 'unknown'
}
''', encoding='utf-8')

(PKG / 'src/adapter.ts').write_text(r'''import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'

export interface NativeDialogRequest {
  action: 'list' | 'inspect' | 'set_value' | 'invoke' | 'select_file' | 'confirm'
  windowId?: string
  controlId?: string
  value?: string
  path?: string
  confirmAction?: 'accept' | 'cancel'
}

export interface NativeDialogResponse { ok: boolean; data?: unknown; error?: string }

const POWERSHELL = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
function RuntimeId($element) { return (($element.GetRuntimeId() | ForEach-Object { [string]$_ }) -join '.') }
function Role($element) {
  $name = $element.Current.ControlType.ProgrammaticName
  switch -Regex ($name) {
    'Button$' { 'button'; break }
    'Edit$' { 'edit'; break }
    'List$|ListItem$' { 'list'; break }
    'Tree$|TreeItem$' { 'tree'; break }
    'ComboBox$' { 'combo'; break }
    'CheckBox$' { 'checkbox'; break }
    default { 'other' }
  }
}
function Controls($window) {
  $all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $result = @()
  foreach ($control in $all) {
    try {
      $result += [pscustomobject]@{
        id = RuntimeId $control
        role = Role $control
        name = [string]$control.Current.Name
        enabled = [bool]$control.Current.IsEnabled
      }
    } catch {}
  }
  return @($result)
}
function Kind($title, $controls) {
  $v = ([string]$title).Trim().ToLowerInvariant()
  if ($v -match 'save as|save file|guardar como|guardar archivo') { return 'save-file' }
  if ($v -match 'open file|choose file|open|abrir archivo|abrir|seleccionar archivo') { return 'open-file' }
  if ($v -match 'select folder|choose folder|browse for folder|seleccionar carpeta|elegir carpeta') { return 'folder-picker' }
  foreach ($c in $controls) {
    $n = ([string]$c.name).Trim().ToLowerInvariant()
    if ($c.role -eq 'button' -and @('yes','no','ok','cancel','sí','si','aceptar','cancelar') -contains $n) { return 'confirmation' }
  }
  return 'unknown'
}
function Windows() {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  return $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
}
function FindWindow($id) {
  foreach ($window in (Windows)) {
    try { if ((RuntimeId $window) -eq $id) { return $window } } catch {}
  }
  throw "stale or unknown window id: $id"
}
function FindControl($window, $id) {
  $all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($control in $all) {
    try { if ((RuntimeId $control) -eq $id) { return $control } } catch {}
  }
  throw "stale or unknown control id: $id"
}
function Summary($window) {
  $controls = Controls $window
  return [pscustomobject]@{
    windowId = RuntimeId $window
    title = [string]$window.Current.Name
    processId = [int]$window.Current.ProcessId
    kind = Kind $window.Current.Name $controls
    controls = @($controls)
  }
}
function ValueSet($control, $value) {
  $pattern = $null
  if (-not $control.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { throw 'control does not support ValuePattern' }
  ([System.Windows.Automation.ValuePattern]$pattern).SetValue([string]$value)
}
function InvokeControl($control) {
  $pattern = $null
  if (-not $control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { throw 'control does not support InvokePattern' }
  ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
}
function FirstEditable($window) {
  foreach ($c in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    if ((Role $c) -eq 'edit' -and $c.Current.IsEnabled) { return $c }
  }
  throw 'dialog has no enabled editable file-name control'
}
function ButtonFor($window, $names) {
  foreach ($c in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    $n = ([string]$c.Current.Name).Trim().ToLowerInvariant()
    if ((Role $c) -eq 'button' -and $c.Current.IsEnabled -and $names -contains $n) { return $c }
  }
  throw ('dialog has no matching semantic button: ' + ($names -join ', '))
}
try {
  $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:PHOENIX_UIA_REQUEST))
  $req = $json | ConvertFrom-Json
  switch ($req.action) {
    'list' {
      $items = @(); foreach ($w in (Windows)) { try { if ($w.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window) { $items += Summary $w } } catch {} }
      [pscustomobject]@{ ok = $true; data = @($items) } | ConvertTo-Json -Depth 8 -Compress
    }
    'inspect' { [pscustomobject]@{ ok = $true; data = (Summary (FindWindow $req.windowId)) } | ConvertTo-Json -Depth 8 -Compress }
    'set_value' { $w=FindWindow $req.windowId; ValueSet (FindControl $w $req.controlId) $req.value; [pscustomobject]@{ok=$true;data=@{changed=$true}} | ConvertTo-Json -Depth 6 -Compress }
    'invoke' { $w=FindWindow $req.windowId; InvokeControl (FindControl $w $req.controlId); [pscustomobject]@{ok=$true;data=@{invoked=$true}} | ConvertTo-Json -Depth 6 -Compress }
    'select_file' {
      $w=FindWindow $req.windowId; $s=Summary $w; ValueSet (FirstEditable $w) $req.path
      if ($s.kind -eq 'save-file') { $b=ButtonFor $w @('save','guardar','aceptar','ok') }
      elseif ($s.kind -eq 'open-file') { $b=ButtonFor $w @('open','abrir','aceptar','ok') }
      else { throw ('select_file requires an open/save dialog, got ' + $s.kind) }
      InvokeControl $b; [pscustomobject]@{ok=$true;data=@{selected=$true;kind=$s.kind}} | ConvertTo-Json -Depth 6 -Compress
    }
    'confirm' {
      $w=FindWindow $req.windowId
      if ($req.confirmAction -eq 'accept') { $b=ButtonFor $w @('yes','ok','accept','aceptar','sí','si','guardar','save','abrir','open') }
      else { $b=ButtonFor $w @('no','cancel','cancelar') }
      InvokeControl $b; [pscustomobject]@{ok=$true;data=@{confirmed=$req.confirmAction}} | ConvertTo-Json -Depth 6 -Compress
    }
    default { throw ('unsupported action: ' + $req.action) }
  }
} catch {
  [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Depth 5 -Compress
  exit 2
}
`

export async function runNativeDialogRequest(request: NativeDialogRequest, signal?: AbortSignal): Promise<NativeDialogResponse> {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows native dialog automation is unavailable on this platform' }
  const encoded = Buffer.from(POWERSHELL, 'utf16le').toString('base64')
  const payload = Buffer.from(JSON.stringify(request), 'utf8').toString('base64')
  return await new Promise((resolveResult, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PHOENIX_UIA_REQUEST: payload },
    })
    let stdout = ''; let stderr = ''
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => child.kill(), 10_000)
    const abort = () => child.kill()
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', reject)
    child.once('exit', () => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
      const line = stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1)
      if (line === undefined) return resolveResult({ ok: false, error: stderr.trim() || 'Windows UI Automation returned no result' })
      try { resolveResult(JSON.parse(line) as NativeDialogResponse) }
      catch { resolveResult({ ok: false, error: `Invalid Windows UI Automation response: ${line.slice(0, 300)}` }) }
    })
  })
}

export const WINDOWS_UIA_SOURCE = POWERSHELL
''', encoding='utf-8')

(PKG / 'src/index.ts').write_text(r'''import { isAbsolute, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { runNativeDialogRequest, type NativeDialogRequest } from './adapter.ts'
import { assertNativeDialogPathAllowed } from './policy.ts'

export const name = 'tool-windows-dialogs'
export const inject = ['tools', 'systemPrompt', 'sandboxPolicy']
export interface Config {}
export const Config: z<Config> = z.object({})

type Args = NativeDialogRequest & { description: string }

function sessionPolicy(service: SandboxPolicyService, exec: ToolExecution): SandboxExecutionPolicy {
  return service.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
}

function resolveRequestedPath(path: string, exec: ToolExecution): string {
  if (isAbsolute(path)) return path
  const cwd = exec.agent?.session.header.cwd ?? process.cwd()
  return resolvePath(cwd, path)
}

export function apply(ctx: Context): void {
  const policy = ctx.sandboxPolicy
  ctx.systemPrompt.section({
    name: 'tool:windows-dialog', order: 108,
    text: 'When a browser or app opens a native Windows Open, Save As, folder-picker, or confirmation dialog that blocks the task, use windows_dialog. List or inspect first and act only on returned window/control ids. Never guess ids or use coordinate clicking. Path actions remain subject to the current PHOENIX HARDNESS file policy. Do not use this tool for ordinary browser DOM interactions.',
  })
  ctx.tools.register(defineTool({
    name: 'windows_dialog',
    description: 'Inspect and operate native Windows dialogs semantically through Windows UI Automation. Use for Open/Save As/folder/confirmation windows that browser DOM tools cannot control. No coordinate-click primitive exists.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list','inspect','set_value','invoke','select_file','confirm'] as const },
      description: { type: 'string', required: true, description: 'Brief active-voice description shown to the user.' },
      windowId: { type: 'string', description: 'Window id returned by list/inspect.' },
      controlId: { type: 'string', description: 'Control id returned by inspect.' },
      value: { type: 'string', description: 'Value for set_value.' },
      path: { type: 'string', description: 'File path for select_file. Relative paths resolve from the session workspace.' },
      confirmAction: { type: 'string', enum: ['accept','cancel'] as const, description: 'Semantic confirmation action.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ok: { type: 'boolean', required: true }, json: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: value.json }],
    },
    async execute(args: Args, exec) {
      if (args.description.trim().length === 0) throw new Error('description must not be empty')
      const request: NativeDialogRequest = { action: args.action }
      if (args.windowId !== undefined) request.windowId = args.windowId
      if (args.controlId !== undefined) request.controlId = args.controlId
      if (args.value !== undefined) request.value = args.value
      if (args.confirmAction !== undefined) request.confirmAction = args.confirmAction
      if (args.action === 'select_file') {
        if (args.path === undefined || args.path.trim().length === 0) throw new Error('select_file requires path')
        const standing = sessionPolicy(policy, exec)
        const candidate = resolveRequestedPath(args.path, exec)
        const operation = /save/iu.test(args.description) ? 'save' : 'open'
        request.path = assertNativeDialogPathAllowed(standing, candidate, operation)
      }
      const result = await runNativeDialogRequest(request, exec.signal)
      return { ok: result.ok, json: JSON.stringify(result, null, 2) }
    },
    presentCall: (args: Args) => ({ card: 'generic', title: 'Windows dialog', kind: 'execute', content: [{ type: 'text', text: args.description }] }),
  }))
}
''', encoding='utf-8')

(PKG / 'tests/windows-dialogs.spec.ts').write_text(r'''import { describe, expect, it } from 'vitest'
import { classifyDialogTitle } from '../src/classify.ts'
import { assertNativeDialogPathAllowed } from '../src/policy.ts'
import { WINDOWS_UIA_SOURCE } from '../src/adapter.ts'

describe('Windows native dialog safety', () => {
  it.each([
    ['Open', 'open-file'], ['Abrir archivo', 'open-file'], ['Save As', 'save-file'], ['Guardar como', 'save-file'],
    ['Select Folder', 'folder-picker'], ['Seleccionar carpeta', 'folder-picker'],
  ])('classifies %s', (title, kind) => expect(classifyDialogTitle(title)).toBe(kind))

  it('recognizes confirmation controls', () => expect(classifyDialogTitle('Question', ['Yes', 'No'])).toBe('confirmation'))

  it('denies workspace escape before UI mutation', () => {
    expect(() => assertNativeDialogPathAllowed({ mode: 'workspace-write', workspaceRoot: 'C:\\safe' }, 'C:\\outside\\x.txt', 'save')).toThrow(/outside PHOENIX workspace/)
  })

  it('denies save under read-only', () => {
    expect(() => assertNativeDialogPathAllowed({ mode: 'read-only', workspaceRoot: 'C:\\safe' }, 'C:\\safe\\x.txt', 'save')).toThrow(/read-only/)
  })

  it('contains no coordinate-click fallback', () => {
    expect(WINDOWS_UIA_SOURCE).not.toMatch(/SetCursorPos|mouse_event|SendInput|\.Click\s*\(/iu)
    expect(WINDOWS_UIA_SOURCE).toMatch(/InvokePattern/)
    expect(WINDOWS_UIA_SOURCE).toMatch(/ValuePattern/)
    expect(WINDOWS_UIA_SOURCE).toMatch(/stale or unknown window id/)
  })
})
''', encoding='utf-8')

# Bundle registration and dependency.
base_pkg_path = ROOT / 'packages/bundle/base/package.json'
base_pkg = json.loads(base_pkg_path.read_text(encoding='utf-8'))
base_pkg.setdefault('dependencies', {})['@deepseek-ai/dsh-tool-windows-dialogs'] = 'workspace:*'
base_pkg['dependencies'] = dict(sorted(base_pkg['dependencies'].items()))
base_pkg_path.write_text(json.dumps(base_pkg, indent=2) + '\n', encoding='utf-8')

patch_path = ROOT / 'packages/bundle/base/cordis.patch.yml'
patch = patch_path.read_text(encoding='utf-8')
needle = "    - id: tool-pwsh\n      name: '@deepseek-ai/dsh-tool-pwsh'\n      disabled: !!js process.platform !== 'win32'\n"
insert = needle + "\n    - id: tool-windows-dialogs\n      name: '@deepseek-ai/dsh-tool-windows-dialogs'\n      disabled: !!js process.platform !== 'win32'\n"
if needle not in patch: raise SystemExit('tool-pwsh bundle anchor missing')
patch_path.write_text(patch.replace(needle, insert, 1), encoding='utf-8')

# Self-delete workflow/script in final commit.
for temp in [ROOT/'.github/workflows/kira-add-windows-dialogs.yml', ROOT/'scripts/kira-add-windows-dialogs.py']:
    if temp.exists(): temp.unlink()
print('Windows dialog capability files generated')
