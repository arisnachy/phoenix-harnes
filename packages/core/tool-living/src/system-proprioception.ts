/**
 * PHOENIX / Living OS: privacy-minimized self-observation of the current Host.
 *
 * No arbitrary shell commands, app launching, installed-package dumps, network,
 * credentials, user paths, device serials, computer names or patient information.
 * "Detected" is NOT "authorized" and never grants tool execution.
 */
import { cpus, totalmem, freemem, arch as osArch, release as osRelease, platform as osPlatform } from 'node:os'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const PROGRAMS = [
  'git','node','pnpm','python','py','ollama','winget','wsl','docker',
  'code','blender','ffmpeg','pwsh','powershell','dotnet','curl','kubectl',
] as const
const GUI_APPS = [
  { id:'vscode', pattern:'Visual Studio Code' },
  { id:'blender', pattern:'Blender' },
  { id:'excel', pattern:'Excel' },
  { id:'word', pattern:'Word' },
  { id:'powerpoint', pattern:'PowerPoint' },
  { id:'powerbi', pattern:'Power BI' },
  { id:'docker-desktop', pattern:'Docker Desktop' },
  { id:'windows-terminal', pattern:'Windows Terminal' },
  { id:'chrome', pattern:'Google Chrome' },
  { id:'edge', pattern:'Microsoft Edge' },
  { id:'firefox', pattern:'Firefox' },
] as const

// The PowerShell code is a constant shipped with PHOENIX, never model-authored.
const POWERSHELL_PROBE = `
$ErrorActionPreference = 'SilentlyContinue'
$commands = @('git','node','pnpm','python','py','ollama','winget','wsl','docker','code','blender','ffmpeg','pwsh','powershell','dotnet','curl','kubectl')
$found = @{}
foreach ($command in $commands) {
  $found[$command] = [bool](Get-Command -Name $command -ErrorAction SilentlyContinue)
}
$system = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue
$os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue
$enclosure = Get-CimInstance -ClassName Win32_SystemEnclosure -ErrorAction SilentlyContinue
$video = @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction SilentlyContinue |
  ForEach-Object { [string]$_.Name } | Where-Object { $_ } | Select-Object -Unique -First 6)
$chassis = @($enclosure.ChassisTypes | ForEach-Object { [int]$_ })
$battery = [bool](@(Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue).Count -gt 0)
$available = @()
if (Get-Command -Name Get-StartApps -ErrorAction SilentlyContinue) {
  $available = @(Get-StartApps -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.Name })
}
$wanted = @{
  vscode = 'Visual Studio Code'; blender = 'Blender'; excel = 'Excel';
  word = 'Word'; powerpoint = 'PowerPoint'; powerbi = 'Power BI';
  'docker-desktop' = 'Docker Desktop'; 'windows-terminal' = 'Windows Terminal';
  chrome = 'Google Chrome'; edge = 'Microsoft Edge'; firefox = 'Firefox'
}
$apps = @{}
foreach ($key in $wanted.Keys) {
  $needle = [string]$wanted[$key]
  $apps[$key] = [bool](@($available | Where-Object {
    $_.IndexOf($needle,[System.StringComparison]::OrdinalIgnoreCase) -ge 0
  }).Count -gt 0)
}
@{
  osCaption = [string]$os.Caption
  build = [string]$os.BuildNumber
  systemType = [int]$system.PCSystemType
  chassis = $chassis
  batteryPresent = $battery
  memoryBytes = [string]$system.TotalPhysicalMemory
  gpuNames = $video
  commands = $found
  apps = $apps
} | ConvertTo-Json -Depth 5 -Compress
`

export type ToolState = 'detected' | 'not-detected' | 'not-checked'
export type PermissionState = 'requires-tool-authorization'
export interface LocalCapability {
  readonly id: string
  readonly command: ToolState
  readonly launchPermission: PermissionState
}
export interface SystemSelfSnapshot {
  readonly schema: 'phoenix.system-self.v1'
  readonly source: 'current-host'
  readonly probe: 'completed' | 'unavailable'
  readonly reason: string | null
  readonly os: { readonly platform: string; readonly arch: string; readonly release: string; readonly caption: string | null; readonly windowsBuild: number | null }
  readonly formFactor: 'desktop'|'laptop'|'tablet'|'other'|'unknown'
  readonly hardware: { readonly cpuModel: string | null; readonly logicalCores: number; readonly ramGiB: number; readonly freeRamGiB: number; readonly gpuNames: readonly string[]; readonly gpuInference: 'not-verified' }
  readonly host: { readonly nodeVersion: string; readonly processAlive: true; readonly hostHealth: 'self-report-only' }
  readonly commands: readonly LocalCapability[]
  readonly guiApps: readonly { readonly id: string; readonly detection: ToolState; readonly launchPermission: PermissionState }[]
  readonly permissions: { readonly commandExecution: 'not-granted-by-inventory'; readonly clinicalAccess: 'not-granted-by-inventory'; readonly remoteAPIs: 'not-granted-by-inventory' }
  readonly limitations: readonly string[]
}

type ExecResult = { status: number | null; stdout?: string | Buffer; error?: unknown }
type ProbeRunner = (command: string, args: readonly string[], options: Record<string,unknown>) => ExecResult
type RawProbe = {
  osCaption?: unknown; build?: unknown; systemType?: unknown; chassis?: unknown
  batteryPresent?: unknown; memoryBytes?: unknown; gpuNames?: unknown
  commands?: unknown; apps?: unknown
}
const safeName = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0
    ? v.replace(/[\u0000-\u001f\u007f]/gu,'').trim().slice(0,90) || null : null
const isRecord = (x: unknown): x is Record<string,unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x)
const boundedInt = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 && n < 10000000 ? n : null
}
function formFactor(raw: RawProbe): SystemSelfSnapshot['formFactor'] {
  const chassis = Array.isArray(raw.chassis) ? raw.chassis.map(Number).filter(Number.isFinite) : []
  if (chassis.some(x => [8,9,10,11,12,14,18,21,30,31,32].includes(x)) || raw.batteryPresent === true) return 'laptop'
  if (chassis.some(x => [13,17,23,24,29].includes(x))) return 'desktop'
  if (chassis.some(x => [1,2,3,4,5,6,7,15,16,19,20].includes(x))) return 'other'
  if (raw.systemType === 2) return 'laptop'
  if (raw.systemType === 1 || raw.systemType === 3) return 'desktop'
  return 'unknown'
}
export function inspectSystemEnvironment(options: {
  readonly platform?: string
  readonly arch?: string
  readonly release?: string
  readonly nodeVersion?: string
  readonly cpus?: readonly { readonly model: string }[]
  readonly totalMemory?: number
  readonly freeMemory?: number
  readonly runner?: ProbeRunner
} = {}): SystemSelfSnapshot {
  const platform = options.platform ?? osPlatform()
  const cpu = (options.cpus ?? cpus())[0]?.model
  const giB = (v: number) => Number.isFinite(v) && v >= 0
    ? Math.round(v / 1073741824 * 10) / 10 : 0
  let raw: RawProbe = {}
  let reason: string | null = platform === 'win32' ? null : 'platform-specific-probe-unavailable'
  if (platform === 'win32') {
    try {
      const run: ProbeRunner = options.runner ?? ((command,args) => spawnSync(command,[...args],{
        encoding:'utf8',windowsHide:true,timeout:9000,maxBuffer:262144,
        stdio:['ignore','pipe','ignore'],
      }))
      const result = run('powershell.exe',[
        '-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',
        Buffer.from(POWERSHELL_PROBE,'utf16le').toString('base64'),
      ],{
        encoding:'utf8',windowsHide:true,timeout:9000,maxBuffer:262144,
        stdio:['ignore','pipe','ignore'],
      })
      if (result.error || result.status !== 0 || typeof result.stdout !== 'string' || result.stdout.length > 262144) {
        reason = 'probe-unavailable'
      } else {
        const parsed: unknown = JSON.parse(result.stdout.trim().replace(/^\uFEFF/u,''))
        if (isRecord(parsed)) raw = parsed
        else reason = 'invalid-probe'
      }
    } catch { reason = 'probe-unavailable' }
  }
  const build = boundedInt(raw.build)
  const commands = isRecord(raw.commands) ? raw.commands : {}
  const apps = isRecord(raw.apps) ? raw.apps : {}
  const measuredMemory = Number(raw.memoryBytes)
  const gpuNames = Array.isArray(raw.gpuNames) ? raw.gpuNames.map(safeName)
    .filter((x):x is string => x !== null).slice(0,6) : []
  return {
    schema:'phoenix.system-self.v1', source:'current-host',
    probe:reason === null ? 'completed' : 'unavailable',reason,
    os:{
      platform,arch:options.arch ?? osArch(),release:(options.release ?? osRelease()).slice(0,60),
      caption:safeName(raw.osCaption), windowsBuild:build,
    },
    formFactor:reason === null ? formFactor(raw) : 'unknown',
    hardware:{
      cpuModel:safeName(cpu),
      logicalCores:Math.min(256,Math.max(0,(options.cpus ?? cpus()).length)),
      ramGiB:giB(Number.isFinite(measuredMemory) && measuredMemory > 0 ? measuredMemory : options.totalMemory ?? totalmem()),
      freeRamGiB:giB(options.freeMemory ?? freemem()),
      gpuNames, gpuInference:'not-verified',
    },
    host:{
      nodeVersion:options.nodeVersion ?? process.versions.node,
      processAlive:true,hostHealth:'self-report-only',
    },
    commands:PROGRAMS.map(id => ({
      id,command:reason !== null ? 'not-checked' : commands[id] === true ? 'detected' : 'not-detected',
      launchPermission:'requires-tool-authorization',
    })),
    guiApps:GUI_APPS.map(({id}) => ({
      id,detection:reason !== null ? 'not-checked' : apps[id] === true ? 'detected' : 'not-detected',
      launchPermission:'requires-tool-authorization',
    })),
    permissions:{
      commandExecution:'not-granted-by-inventory',
      clinicalAccess:'not-granted-by-inventory',
      remoteAPIs:'not-granted-by-inventory',
    },
    limitations:[
      'Command presence is not application health or permission.',
      'Start-menu detection is incomplete and does not prove program launchability.',
      'No credentials, device IDs, complete process lists or private documents were inspected.',
      'Use the supervised Host and existing authorized tools before taking any action.',
    ],
  }
}

/**
 * On-demand search for a USER-SPECIFIED application name in Windows StartApps.
 * Never enumerate the full installed-program catalog, paths, AppIDs or processes
 * in a model context. Presence is NOT permission or launch readiness.
 */
export function searchLocalApps(query:string, options:{
  platform?:string;runner?:ProbeRunner
} = {}):{
  schema:'phoenix.app-discovery.v1';query:string
  status:'matches'|'no-match'|'unavailable'|'invalid-query'
  names:readonly string[];authorized:false
} {
  if(typeof query!=='string'||!/^[\\p{L}\\p{N} ._-]{2,48}$/u.test(query)||query.trim()!==query) {
    return {schema:'phoenix.app-discovery.v1',query:'',status:'invalid-query',names:[],authorized:false}
  }
  if((options.platform??osPlatform())!=='win32') {
    return {schema:'phoenix.app-discovery.v1',query,status:'unavailable',names:[],authorized:false}
  }
  // No shell interpolation: the user query enters PowerShell only as UTF-8
  // base64 data inside a fixed, bounded script and never becomes code.
  const encoded=Buffer.from(query,'utf8').toString('base64')
  const ps=`$ErrorActionPreference='SilentlyContinue'
$term=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
$found=@(Get-StartApps -ErrorAction SilentlyContinue |
  Where-Object { $_.Name.IndexOf($term,[System.StringComparison]::OrdinalIgnoreCase) -ge 0 } |
  Select-Object -First 16 -ExpandProperty Name)
@{matches=$found} | ConvertTo-Json -Depth 3 -Compress`
  try {
    const run:ProbeRunner=options.runner??((cmd,args)=>spawnSync(cmd,[...args],{
      encoding:'utf8',windowsHide:true,timeout:6000,maxBuffer:16384,
      stdio:['ignore','pipe','ignore'],
    }))
    const output=run('powershell.exe',[
      '-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',
      Buffer.from(ps,'utf16le').toString('base64'),
    ],{encoding:'utf8',windowsHide:true,timeout:6000,maxBuffer:16384})
    if(output.error||output.status!==0||typeof output.stdout!=='string'||output.stdout.length>16384)
      throw Error('unavailable')
    const raw:unknown=JSON.parse(output.stdout)
    if(!isRecord(raw)||!Array.isArray(raw.matches))throw Error('invalid')
    const names=raw.matches.map(safeName).filter((x):x is string=>x!==null).slice(0,16)
    return {schema:'phoenix.app-discovery.v1',query,
      status:names.length?'matches':'no-match',names,authorized:false}
  } catch {
    return {schema:'phoenix.app-discovery.v1',query,status:'unavailable',names:[],authorized:false}
  }
}
