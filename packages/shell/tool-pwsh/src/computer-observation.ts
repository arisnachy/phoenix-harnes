/**
 * Read-only Windows desktop observation helpers used by Computer Use.
 * Window metadata is collected through fixed Win32 calls; model text never
 * becomes PowerShell source.
 *
 * @module @phoenix-ai/dsh-tool-pwsh/computer-observation
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** One visible top-level application window reported by Windows. */
export interface VisibleWindow {
  /** Owning process executable name without extension where Windows supplies it. */
  process: string
  /** Current top-level window title. */
  title: string
  /** Left edge in virtual-screen coordinates. */
  x: number
  /** Top edge in virtual-screen coordinates. */
  y: number
  /** Window width in pixels. */
  width: number
  /** Window height in pixels. */
  height: number
}

/** Fixed native invocation used to enumerate visible application windows. */
export interface VisibleWindowsInvocation {
  /** Windows PowerShell executable. */
  file: string
  /** Fixed, model-independent argument vector. */
  argv: readonly string[]
}

const WINDOWS_VISIBLE_WINDOWS_DRIVER = String.raw`
$ErrorActionPreference = 'Stop'
$source = @"
using System;
using System.Runtime.InteropServices;

public static class PhoenixWindowProbe {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
"@

Add-Type -TypeDefinition $source -Language CSharp
$windows = @()
Get-Process | ForEach-Object {
  try {
    $handle = $_.MainWindowHandle
    $title = $_.MainWindowTitle
    if ($handle -eq 0 -or [string]::IsNullOrWhiteSpace($title)) { return }
    if (-not [PhoenixWindowProbe]::IsWindowVisible($handle)) { return }
    $rect = New-Object PhoenixWindowProbe+RECT
    if (-not [PhoenixWindowProbe]::GetWindowRect($handle, [ref]$rect)) { return }
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -le 0 -or $height -le 0) { return }
    $windows += [pscustomobject]@{
      process = $_.ProcessName
      title = $title
      x = $rect.Left
      y = $rect.Top
      width = $width
      height = $height
    }
  } catch {
    # A process may disappear or deny inspection between enumeration and read.
  }
}
ConvertTo-Json -InputObject @($windows | Sort-Object process, title) -Compress -Depth 3
`

const ENCODED_VISIBLE_WINDOWS_DRIVER = Buffer.from(WINDOWS_VISIBLE_WINDOWS_DRIVER, 'utf16le').toString('base64')

/**
 * Build the fixed PowerShell invocation used for visible-window observation.
 * @returns Executable and argument vector containing no model-provided text.
 */
export function visibleWindowsInvocation(): VisibleWindowsInvocation {
  return {
    file: 'powershell.exe',
    argv: ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', ENCODED_VISIBLE_WINDOWS_DRIVER],
  }
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

/**
 * Parse the fixed PowerShell window inventory into a defensive typed list.
 * Malformed entries are ignored rather than being presented as desktop facts.
 * @param stdout - JSON emitted by {@link visibleWindowsInvocation}.
 * @returns Valid visible application windows in driver order.
 */
export function parseVisibleWindows(stdout: string): VisibleWindow[] {
  const text = stdout.trim()
  if (text.length === 0) return []
  const parsed: unknown = JSON.parse(text)
  const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
  const windows: VisibleWindow[] = []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    const processName = typeof candidate.process === 'string' ? candidate.process.trim() : ''
    const title = typeof candidate.title === 'string' ? candidate.title.replace(/[\r\n]+/gu, ' ').trim() : ''
    const x = finiteInteger(candidate.x)
    const y = finiteInteger(candidate.y)
    const width = finiteInteger(candidate.width)
    const height = finiteInteger(candidate.height)
    if (processName.length === 0 || title.length === 0 || x === undefined || y === undefined
      || width === undefined || height === undefined || width <= 0 || height <= 0) continue
    windows.push({ process: processName, title, x, y, width, height })
  }
  return windows
}

/**
 * Format visible application windows as model-readable desktop observation.
 * @param windows - Validated visible top-level application windows.
 * @returns Compact text sufficient for text-only models to identify visible apps.
 */
export function formatVisibleWindows(windows: readonly VisibleWindow[]): string {
  if (windows.length === 0) {
    return 'No visible top-level application windows were reported by Windows.'
  }
  return [
    `Visible application windows (${windows.length}):`,
    ...windows.map(window => `- ${window.process} — "${window.title}" [${window.x},${window.y} ${window.width}x${window.height}]`),
  ].join('\n')
}

/**
 * Enumerate visible top-level application windows through the fixed Windows driver.
 * @param signal - Optional cancellation signal forwarded to PowerShell.
 * @returns Validated visible application windows.
 */
export async function runWindowsVisibleWindows(signal?: AbortSignal): Promise<VisibleWindow[]> {
  if (process.platform !== 'win32') {
    throw new Error(`Computer Use Windows observation driver is unavailable on ${process.platform}`)
  }
  signal?.throwIfAborted()
  const invocation = visibleWindowsInvocation()
  const { stdout } = await execFileAsync(invocation.file, [...invocation.argv], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    ...signal === undefined ? {} : { signal },
  })
  return parseVisibleWindows(stdout)
}
