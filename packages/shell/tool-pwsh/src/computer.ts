/**
 * Windows Computer Use for PHOENIX. The model sees a closed action vocabulary;
 * implementation details stay behind a fixed PowerShell/C# driver so model
 * text can never become executable shell source.
 *
 * Permission mapping intentionally reuses the durable sandbox policy:
 * read-only -> observe, workspace-write/danger-full-access -> interact.
 * Interactive actions under workspace-write require the ordinary user approval
 * channel; danger-full-access is the explicit no-prompt desktop authority.
 *
 * @module @phoenix-ai/dsh-tool-pwsh/computer
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Context } from '@phoenix-ai/cordis'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import type { ImageAttachmentRef } from '@phoenix-ai/dsh-attachment'
import type {} from '@phoenix-ai/dsh-attachment'
import type { SandboxMode } from '@phoenix-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@phoenix-ai/dsh-sandbox-policy'
import { defineTool } from '@phoenix-ai/dsh-tools'

const execFileAsync = promisify(execFile)

/** Desktop authority derived from the session's existing permission policy. */
export type ComputerMode = 'off' | 'observe' | 'interact'

/** Closed model-facing action vocabulary. */
export type ComputerAction =
  | 'screenshot'
  | 'move'
  | 'click'
  | 'double_click'
  | 'drag'
  | 'type'
  | 'key'
  | 'scroll'

export type ComputerButton = 'left' | 'right' | 'middle'

export interface ComputerToolArgs {
  action: ComputerAction
  x?: number
  y?: number
  x2?: number
  y2?: number
  button?: ComputerButton
  text?: string
  keys?: string
  delta?: number
}

interface ComputerInvocation {
  file: string
  argv: readonly string[]
  env: Readonly<Record<string, string>>
}

/** Map the existing sandbox authority onto desktop authority. */
export function computerModeForSandbox(mode: SandboxMode | undefined): ComputerMode {
  if (mode === 'read-only') return 'observe'
  if (mode === 'workspace-write' || mode === 'danger-full-access') return 'interact'
  return 'off'
}

/** Fail closed when an action is outside the current desktop authority. */
export function assertComputerActionAllowed(mode: ComputerMode, action: ComputerAction): void {
  if (mode === 'off') {
    throw new Error('Computer Use is disabled by the current permission mode.')
  }
  if (mode === 'observe' && action !== 'screenshot') {
    throw new Error(`Computer action "${action}" requires interact permission; current mode is observe.`)
  }
}

function assertCoordinate(value: number | undefined, name: string): asserts value is number {
  if (value === undefined || !Number.isSafeInteger(value)) {
    throw new TypeError(`computer ${name} must be a safe integer coordinate`)
  }
}

function assertOptionalPointPair(args: ComputerToolArgs): void {
  const one = args.x !== undefined || args.y !== undefined
  if (!one) return
  assertCoordinate(args.x, 'x')
  assertCoordinate(args.y, 'y')
}

const KEY_COMBO = /^[A-Za-z0-9_+\-]+$/u

/** Validate cross-field action requirements before touching the OS. */
export function validateComputerArgs(args: ComputerToolArgs): void {
  switch (args.action) {
    case 'screenshot':
      return
    case 'move':
    case 'click':
    case 'double_click':
      assertCoordinate(args.x, 'x')
      assertCoordinate(args.y, 'y')
      return
    case 'drag':
      assertCoordinate(args.x, 'x')
      assertCoordinate(args.y, 'y')
      assertCoordinate(args.x2, 'x2')
      assertCoordinate(args.y2, 'y2')
      return
    case 'type':
      if (args.text === undefined || args.text.length === 0) {
        throw new TypeError('computer type requires non-empty text')
      }
      if (args.text.length > 16_384) {
        throw new RangeError('computer type text exceeds 16384 UTF-16 code units')
      }
      return
    case 'key':
      if (args.keys === undefined || args.keys.trim().length === 0) {
        throw new TypeError('computer key requires a non-empty key combo')
      }
      if (args.keys.length > 128 || !KEY_COMBO.test(args.keys)) {
        throw new TypeError('computer key combo contains unsupported characters')
      }
      return
    case 'scroll':
      if (args.delta === undefined || !Number.isSafeInteger(args.delta) || args.delta === 0) {
        throw new TypeError('computer scroll requires a non-zero safe integer delta')
      }
      assertOptionalPointPair(args)
      return
    default: {
      const neverAction: never = args.action
      throw new TypeError(`unsupported computer action: ${String(neverAction)}`)
    }
  }
}

const WINDOWS_DRIVER = String.raw`
$ErrorActionPreference = 'Stop'
$source = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public static class PhoenixDesktop {
  private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  private const uint MOUSEEVENTF_LEFTUP = 0x0004;
  private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
  private const uint MOUSEEVENTF_WHEEL = 0x0800;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  private const uint KEYEVENTF_UNICODE = 0x0004;
  private const uint INPUT_KEYBOARD = 1;

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  private static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extraInfo);

  [DllImport("user32.dll")]
  private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint count, INPUT[] inputs, int size);

  [DllImport("user32.dll")]
  private static extern bool SetProcessDPIAware();

  [StructLayout(LayoutKind.Sequential)]
  private struct INPUT {
    public uint type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Explicit)]
  private struct InputUnion {
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  public static void EnableDpiAwareness() {
    try { SetProcessDPIAware(); } catch { }
  }

  public static void Move(int x, int y) {
    if (!SetCursorPos(x, y)) throw new InvalidOperationException("SetCursorPos failed");
  }

  private static Tuple<uint, uint> ButtonFlags(string button) {
    switch ((button ?? "left").ToLowerInvariant()) {
      case "left": return Tuple.Create(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP);
      case "right": return Tuple.Create(MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP);
      case "middle": return Tuple.Create(MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP);
      default: throw new ArgumentException("unsupported mouse button: " + button);
    }
  }

  private static void ButtonDown(string button) {
    var flags = ButtonFlags(button);
    mouse_event(flags.Item1, 0, 0, 0, UIntPtr.Zero);
  }

  private static void ButtonUp(string button) {
    var flags = ButtonFlags(button);
    mouse_event(flags.Item2, 0, 0, 0, UIntPtr.Zero);
  }

  public static void Click(int x, int y, string button, int count) {
    Move(x, y);
    for (int i = 0; i < count; i++) {
      ButtonDown(button);
      Thread.Sleep(35);
      ButtonUp(button);
      if (i + 1 < count) Thread.Sleep(70);
    }
  }

  public static void Drag(int x, int y, int x2, int y2, string button) {
    Move(x, y);
    ButtonDown(button);
    try {
      const int steps = 12;
      for (int i = 1; i <= steps; i++) {
        int nx = x + ((x2 - x) * i / steps);
        int ny = y + ((y2 - y) * i / steps);
        Move(nx, ny);
        Thread.Sleep(18);
      }
    } finally {
      ButtonUp(button);
    }
  }

  public static void Scroll(int delta) {
    mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, UIntPtr.Zero);
  }

  public static void TypeText(string text) {
    if (text == null) return;
    foreach (char ch in text) {
      var inputs = new INPUT[2];
      inputs[0].type = INPUT_KEYBOARD;
      inputs[0].U.ki.wScan = ch;
      inputs[0].U.ki.dwFlags = KEYEVENTF_UNICODE;
      inputs[1].type = INPUT_KEYBOARD;
      inputs[1].U.ki.wScan = ch;
      inputs[1].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
      uint sent = SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
      if (sent != 2) throw new InvalidOperationException("SendInput failed while typing text");
    }
  }

  private static byte KeyCode(string token) {
    string key = token.Trim().ToUpperInvariant();
    var named = new Dictionary<string, byte> {
      { "CTRL", 0x11 }, { "CONTROL", 0x11 }, { "ALT", 0x12 }, { "SHIFT", 0x10 },
      { "WIN", 0x5B }, { "META", 0x5B }, { "ENTER", 0x0D }, { "RETURN", 0x0D },
      { "ESC", 0x1B }, { "ESCAPE", 0x1B }, { "TAB", 0x09 }, { "BACKSPACE", 0x08 },
      { "DELETE", 0x2E }, { "UP", 0x26 }, { "DOWN", 0x28 }, { "LEFT", 0x25 },
      { "RIGHT", 0x27 }, { "HOME", 0x24 }, { "END", 0x23 }, { "PAGEUP", 0x21 },
      { "PAGEDOWN", 0x22 }, { "SPACE", 0x20 }
    };
    byte code;
    if (named.TryGetValue(key, out code)) return code;
    if (key.Length == 1) {
      char ch = key[0];
      if ((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) return (byte)ch;
    }
    if (key.StartsWith("F")) {
      int number;
      if (Int32.TryParse(key.Substring(1), out number) && number >= 1 && number <= 24) {
        return (byte)(0x70 + number - 1);
      }
    }
    throw new ArgumentException("unsupported key: " + token);
  }

  public static void KeyCombo(string combo) {
    string[] parts = combo.Split(new[] { '+' }, StringSplitOptions.RemoveEmptyEntries);
    if (parts.Length == 0) throw new ArgumentException("empty key combo");
    var codes = new List<byte>();
    foreach (string part in parts) codes.Add(KeyCode(part));
    foreach (byte code in codes) keybd_event(code, 0, 0, UIntPtr.Zero);
    Thread.Sleep(25);
    for (int i = codes.Count - 1; i >= 0; i--) keybd_event(codes[i], 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }
}
"@

Add-Type -TypeDefinition $source -Language CSharp
[PhoenixDesktop]::EnableDpiAwareness()
$action = $env:PHX_ACTION
$button = if ($env:PHX_BUTTON) { $env:PHX_BUTTON } else { 'left' }

switch ($action) {
  'screenshot' {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    if ($bounds.Width -le 0 -or $bounds.Height -le 0) { throw 'desktop has no capturable virtual screen' }
    $bitmap = New-Object System.Drawing.Bitmap -ArgumentList $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
      $stream = New-Object System.IO.MemoryStream
      try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        [Convert]::ToBase64String($stream.ToArray())
      } finally {
        $stream.Dispose()
      }
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
  'move' { [PhoenixDesktop]::Move([int]$env:PHX_X, [int]$env:PHX_Y) }
  'click' { [PhoenixDesktop]::Click([int]$env:PHX_X, [int]$env:PHX_Y, $button, 1) }
  'double_click' { [PhoenixDesktop]::Click([int]$env:PHX_X, [int]$env:PHX_Y, $button, 2) }
  'drag' { [PhoenixDesktop]::Drag([int]$env:PHX_X, [int]$env:PHX_Y, [int]$env:PHX_X2, [int]$env:PHX_Y2, $button) }
  'type' { [PhoenixDesktop]::TypeText($env:PHX_TEXT) }
  'key' { [PhoenixDesktop]::KeyCombo($env:PHX_KEYS) }
  'scroll' {
    if ($env:PHX_X -and $env:PHX_Y) { [PhoenixDesktop]::Move([int]$env:PHX_X, [int]$env:PHX_Y) }
    [PhoenixDesktop]::Scroll([int]$env:PHX_DELTA)
  }
  default { throw "unsupported PHX_ACTION: $action" }
}
`

const ENCODED_WINDOWS_DRIVER = Buffer.from(WINDOWS_DRIVER, 'utf16le').toString('base64')

function putNumber(env: Record<string, string>, key: string, value: number | undefined): void {
  if (value !== undefined) env[key] = String(value)
}

/** Build the injection-safe native invocation. Model-provided strings travel only as environment values. */
export function windowsComputerInvocation(args: ComputerToolArgs): ComputerInvocation {
  validateComputerArgs(args)
  const env: Record<string, string> = { PHX_ACTION: args.action }
  putNumber(env, 'PHX_X', args.x)
  putNumber(env, 'PHX_Y', args.y)
  putNumber(env, 'PHX_X2', args.x2)
  putNumber(env, 'PHX_Y2', args.y2)
  putNumber(env, 'PHX_DELTA', args.delta)
  if (args.button !== undefined) env.PHX_BUTTON = args.button
  if (args.text !== undefined) env.PHX_TEXT = args.text
  if (args.keys !== undefined) env.PHX_KEYS = args.keys
  return {
    file: 'powershell.exe',
    argv: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_WINDOWS_DRIVER],
    env,
  }
}

/** Execute one fixed Windows desktop action and return stdout (base64 PNG for screenshot). */
export async function runWindowsComputerAction(args: ComputerToolArgs, signal?: AbortSignal): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error(`Computer Use Windows driver is unavailable on ${process.platform}`)
  }
  signal?.throwIfAborted()
  const invocation = windowsComputerInvocation(args)
  const { stdout, stderr } = await execFileAsync(invocation.file, [...invocation.argv], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...invocation.env },
    ...signal === undefined ? {} : { signal },
  })
  if (stderr.trim().length > 0) {
    // PowerShell can write non-fatal progress to stderr, but this driver sets
    // ErrorActionPreference=Stop; preserve diagnostics only when no stdout was expected.
    if (args.action !== 'screenshot' && stdout.trim().length === 0) return ''
  }
  return stdout.trim()
}

function inputRisk(action: ComputerAction): { risk: 'low' | 'medium' | 'high'; reversible: boolean } {
  if (action === 'move' || action === 'scroll') return { risk: 'low', reversible: true }
  if (action === 'click' || action === 'double_click' || action === 'drag') return { risk: 'medium', reversible: false }
  return { risk: 'high', reversible: false }
}

async function authorizeComputerAction(
  ctx: Context,
  exec: { agent?: { session: { events: readonly unknown[] }; inject: (message: unknown) => void }; callId?: unknown; signal: AbortSignal },
  action: ComputerAction,
  sandboxMode: SandboxMode | undefined,
): Promise<void> {
  const mode = computerModeForSandbox(sandboxMode)
  assertComputerActionAllowed(mode, action)
  if (action === 'screenshot' || sandboxMode === 'danger-full-access') return
  const agent = exec.agent
  if (agent === undefined) throw new Error('Computer input requires an owning agent session')
  const approval = ctx.get('approval')
  if (approval === undefined) throw new Error('Computer input requires the approval service; refusing action')
  const risk = inputRisk(action)
  const outcome = await approval.request({
    agent: agent as never,
    toolName: 'computer',
    callId: exec.callId as never,
    reason: `Allow PHOENIX to perform desktop ${action.replace('_', ' ')}?`,
    risk: risk.risk,
    reversible: risk.reversible,
    signal: exec.signal,
  })
  if (outcome !== 'allowed-once') {
    throw new Error(`Computer action "${action}" was not approved (${outcome}).`)
  }
}

/** Register the model-facing Computer Use tool on Windows compositions. */
export function registerComputerTool(ctx: Context): void {
  if (process.platform !== 'win32') return
  const sandboxPolicy: SandboxPolicyService | undefined = ctx.get('sandboxPolicy')
  const deploymentDefault = ctx.shell.sandboxMode

  ctx.tools.register(defineTool({
    name: 'computer',
    description: 'Control the Windows desktop with a closed action set. Use screenshot to observe the current virtual desktop; the screenshot is injected as a durable image attachment for the next model step. Input actions are move, click, double_click, drag, type, key, and scroll. read-only permission is observe-only; workspace-write allows input through user approval; danger-full-access allows input without prompts. Never guess coordinates when a fresh screenshot can ground them.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['screenshot', 'move', 'click', 'double_click', 'drag', 'type', 'key', 'scroll'],
        description: 'Desktop operation to perform.',
      },
      x: { type: 'integer', description: 'Screen X coordinate. Required for move/click/double_click/drag; optional with scroll.' },
      y: { type: 'integer', description: 'Screen Y coordinate. Required for move/click/double_click/drag; optional with scroll.' },
      x2: { type: 'integer', description: 'Drag destination X coordinate.' },
      y2: { type: 'integer', description: 'Drag destination Y coordinate.' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button; defaults to left.' },
      text: { type: 'string', description: 'Unicode text for the type action.' },
      keys: { type: 'string', description: 'Key or combo such as ENTER, CTRL+L, ALT+TAB, F5, or SHIFT+F10.' },
      delta: { type: 'integer', description: 'Mouse-wheel delta for scroll; positive scrolls up and negative scrolls down.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          status: { type: 'string', required: true, const: 'ok' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.action === 'screenshot'
          ? 'Desktop screenshot captured and attached for the next model step.'
          : `Desktop ${value.action} completed.`,
      }],
    },
    async execute(args: ComputerToolArgs, exec) {
      validateComputerArgs(args)
      const session = exec.agent?.session
      const policy = sandboxPolicy?.resolve(session === undefined ? {} : { session })
      const sandboxMode = policy?.mode ?? deploymentDefault
      await authorizeComputerAction(ctx, exec, args.action, sandboxMode)
      const output = await runWindowsComputerAction(args, exec.signal)
      if (args.action === 'screenshot') {
        if (exec.agent === undefined) throw new Error('Computer screenshot requires an owning agent session')
        if (output.length === 0) throw new Error('Computer screenshot driver returned no image bytes')
        const bytes = Buffer.from(output, 'base64')
        if (bytes.length === 0) throw new Error('Computer screenshot decoded to an empty image')
        const attachments = ctx.get('attachments')
        if (attachments === undefined) throw new Error('Computer screenshot requires the attachment service')
        const attachment: ImageAttachmentRef = await attachments.saveImage({
          data: bytes,
          mediaType: 'image/png',
          name: 'phoenix-desktop.png',
        })
        exec.agent.inject(createUserMessage({
          content: [
            { type: 'text', text: `PHOENIX desktop screenshot (${attachment.width}x${attachment.height}).` },
            { type: 'image', attachment },
          ],
          source: { kind: 'plugin', plugin: 'computer-use' },
        }))
      }
      return { action: args.action, status: 'ok' as const }
    },
  }))
}
