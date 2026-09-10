/**
 * Window-aware Windows Computer Use for PHOENIX.
 *
 * The model sees a closed action vocabulary and never supplies executable shell
 * source. All model strings are transported through environment variables into
 * a fixed PowerShell/C# driver. Desktop input is guarded by the session's
 * sandbox authority and, when requested, by an explicit top-level window
 * selector. State-changing actions automatically produce a fresh screenshot so
 * the next model step observes what actually happened instead of trusting that
 * input injection alone meant success.
 *
 * @module @phoenix-ai/dsh-tool-pwsh/computer
 */

import { execFile } from 'node:child_process'
import type { Context } from '@phoenix-ai/cordis'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import type { ContentBlock } from '@phoenix-ai/dsh-llm'
import type { SandboxMode } from '@phoenix-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@phoenix-ai/dsh-sandbox-policy'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@phoenix-ai/dsh-tools'

const POST_ACTION_SETTLE_MS = 250
const INT32_MIN = -2_147_483_648
const INT32_MAX = 2_147_483_647

/** Desktop authority derived from the session's existing permission policy. */
export type ComputerMode = 'off' | 'observe' | 'interact'

/** Closed model-facing action vocabulary. */
export type ComputerAction =
  | 'screenshot'
  | 'windows'
  | 'focus'
  | 'move'
  | 'click'
  | 'double_click'
  | 'drag'
  | 'type'
  | 'key'
  | 'scroll'

/** Mouse buttons accepted by the Windows driver. */
export type ComputerButton = 'left' | 'right' | 'middle'

/** Model-facing arguments for one desktop operation. */
export interface ComputerToolArgs {
  action: ComputerAction
  /**
   * Optional top-level window selector. Supported forms are a title or title
   * substring, pid:1234, and hwnd:0x123ABC. focus requires this field.
   */
  target?: string
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
  stdin: string
}

interface DesktopImageAttachment {
  readonly width: number
  readonly height: number
}

interface AttachmentWriter {
  saveImage(input: { data: Buffer; mediaType: 'image/png'; name: string }): Promise<DesktopImageAttachment>
}

/** Resolve the optional attachment capability without adding a hard package edge. */
function attachmentWriter(ctx: Context): AttachmentWriter | undefined {
  return (ctx as unknown as { attachments?: AttachmentWriter }).attachments
}

/**
 * Map the existing sandbox authority onto desktop authority.
 * @param mode - Effective sandbox mode for the current session/deployment.
 * @returns Desktop authority that is never wider than the sandbox authority.
 */
export function computerModeForSandbox(mode: SandboxMode | undefined): ComputerMode {
  if (mode === 'read-only') return 'observe'
  if (mode === 'workspace-write' || mode === 'danger-full-access') return 'interact'
  return 'off'
}

/**
 * Fail closed when an action is outside the current desktop authority.
 * @param mode - Effective Computer Use authority.
 * @param action - Requested closed-set desktop action.
 */
export function assertComputerActionAllowed(mode: ComputerMode, action: ComputerAction): void {
  if (mode === 'off') {
    throw new Error('Computer Use is disabled by the current permission mode.')
  }
  const observationOnly = action === 'screenshot' || action === 'windows'
  if (mode === 'observe' && !observationOnly) {
    throw new Error(`Computer action "${action}" requires interact permission; current mode is observe.`)
  }
}

function assertCoordinate(value: number | undefined, name: string): asserts value is number {
  if (value === undefined || !Number.isSafeInteger(value) || value < INT32_MIN || value > INT32_MAX) {
    throw new TypeError(`computer ${name} must be a signed 32-bit integer coordinate`)
  }
}

function assertOptionalPointPair(args: ComputerToolArgs): void {
  const one = args.x !== undefined || args.y !== undefined
  if (!one) return
  assertCoordinate(args.x, 'x')
  assertCoordinate(args.y, 'y')
}

function validateTarget(target: string | undefined, required: boolean): void {
  if (target === undefined) {
    if (required) throw new TypeError('computer focus requires a non-empty target window selector')
    return
  }
  if (target.trim().length === 0) throw new TypeError('computer target must be non-empty')
  if (target.length > 512) throw new RangeError('computer target exceeds 512 UTF-16 code units')
  if (target.includes('\0')) throw new TypeError('computer target contains an unsupported NUL character')
}

const KEY_COMBO = /^[A-Za-z0-9_+\-]+$/u

/**
 * Validate cross-field action requirements before touching the OS.
 * @param args - Model-facing desktop action and its action-specific fields.
 */
export function validateComputerArgs(args: ComputerToolArgs): void {
  validateTarget(args.target, args.action === 'focus')
  switch (args.action) {
    case 'screenshot':
    case 'windows':
    case 'focus':
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
      if (args.delta === undefined || !Number.isSafeInteger(args.delta)
        || args.delta < INT32_MIN || args.delta > INT32_MAX || args.delta === 0) {
        throw new TypeError('computer scroll requires a non-zero signed 32-bit integer delta')
      }
      assertOptionalPointPair(args)
      return
    default: {
      const neverAction: never = args.action
      throw new TypeError(`unsupported computer action: ${String(neverAction)}`)
    }
  }
}

/**
 * Determine whether an action must be followed by a fresh visual observation.
 * @param action - Closed-set Computer Use action.
 * @returns True when the action can change desktop/application state in a way the model must re-observe.
 */
export function shouldCaptureAfterAction(action: ComputerAction): boolean {
  return action === 'focus'
    || action === 'click'
    || action === 'double_click'
    || action === 'drag'
    || action === 'type'
    || action === 'key'
    || action === 'scroll'
}

const WINDOWS_DRIVER = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$source = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
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
  private const int SW_RESTORE = 9;

  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

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

  [DllImport("user32.dll")]
  private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  private static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  private static extern bool IsWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  private static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetWindowTextLength(IntPtr hWnd);

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  private static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  private static extern bool BringWindowToTop(IntPtr hWnd);

  [DllImport("user32.dll")]
  private static extern bool ShowWindowAsync(IntPtr hWnd, int command);

  [DllImport("user32.dll")]
  private static extern uint GetCurrentThreadId();

  [DllImport("user32.dll")]
  private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);

  [DllImport("user32.dll")]
  private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [StructLayout(LayoutKind.Sequential)]
  private struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct INPUT {
    public uint type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct HARDWAREINPUT {
    public uint uMsg;
    public ushort wParamL;
    public ushort wParamH;
  }

  [StructLayout(LayoutKind.Explicit)]
  private struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }

  public static void EnableDpiAwareness() {
    try { SetProcessDPIAware(); } catch { }
  }

  private static string Title(IntPtr hWnd) {
    int length = GetWindowTextLength(hWnd);
    if (length <= 0) return String.Empty;
    var text = new StringBuilder(length + 1);
    GetWindowText(hWnd, text, text.Capacity);
    return text.ToString().Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ').Trim();
  }

  private static List<IntPtr> VisibleWindows() {
    var result = new List<IntPtr>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      if (IsWindowVisible(hWnd) && Title(hWnd).Length > 0) result.Add(hWnd);
      return true;
    }, IntPtr.Zero);
    return result;
  }

  private static string Hex(IntPtr hWnd) {
    return "0x" + hWnd.ToInt64().ToString("X");
  }

  public static string DescribeWindow(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return "hwnd=0x0 active=false title=<none>";
    uint pid;
    GetWindowThreadProcessId(hWnd, out pid);
    RECT rect;
    bool hasRect = GetWindowRect(hWnd, out rect);
    bool active = GetForegroundWindow() == hWnd;
    string bounds = hasRect
      ? (" bounds=" + rect.Left + "," + rect.Top + "," + rect.Right + "," + rect.Bottom)
      : String.Empty;
    return "hwnd=" + Hex(hWnd) + " pid=" + pid + " active=" + active.ToString().ToLowerInvariant()
      + bounds + " title=" + Title(hWnd);
  }

  public static string ListWindows() {
    var lines = new List<string>();
    foreach (IntPtr hWnd in VisibleWindows()) lines.Add(DescribeWindow(hWnd));
    if (lines.Count == 0) return "<no visible top-level windows>";
    return String.Join(Environment.NewLine, lines.ToArray());
  }

  private static IntPtr ParseHandle(string raw) {
    string value = (raw ?? String.Empty).Trim();
    long parsed;
    if (value.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) {
      try { parsed = Convert.ToInt64(value.Substring(2), 16); }
      catch { throw new ArgumentException("invalid hwnd selector: " + raw); }
    } else if (!Int64.TryParse(value, out parsed)) {
      throw new ArgumentException("invalid hwnd selector: " + raw);
    }
    IntPtr hWnd = new IntPtr(parsed);
    if (!IsWindow(hWnd)) throw new ArgumentException("window handle does not exist: " + raw);
    return hWnd;
  }

  public static IntPtr ResolveWindow(string selector) {
    string wanted = (selector ?? String.Empty).Trim();
    if (wanted.Length == 0) throw new ArgumentException("empty window selector");

    if (wanted.StartsWith("hwnd:", StringComparison.OrdinalIgnoreCase)) {
      return ParseHandle(wanted.Substring(5));
    }

    if (wanted.StartsWith("pid:", StringComparison.OrdinalIgnoreCase)) {
      uint wantedPid;
      if (!UInt32.TryParse(wanted.Substring(4).Trim(), out wantedPid)) {
        throw new ArgumentException("invalid pid selector: " + selector);
      }
      var matches = new List<IntPtr>();
      IntPtr foreground = GetForegroundWindow();
      foreach (IntPtr hWnd in VisibleWindows()) {
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (pid == wantedPid) {
          if (hWnd == foreground) return hWnd;
          matches.Add(hWnd);
        }
      }
      if (matches.Count == 0) throw new ArgumentException("no visible window for " + selector);
      return matches[0];
    }

    var exact = new List<IntPtr>();
    var partial = new List<IntPtr>();
    foreach (IntPtr hWnd in VisibleWindows()) {
      string title = Title(hWnd);
      if (String.Equals(title, wanted, StringComparison.OrdinalIgnoreCase)) exact.Add(hWnd);
      else if (title.IndexOf(wanted, StringComparison.OrdinalIgnoreCase) >= 0) partial.Add(hWnd);
    }
    var candidates = exact.Count > 0 ? exact : partial;
    if (candidates.Count == 0) throw new ArgumentException("no visible window matches target: " + selector);
    if (candidates.Count == 1) return candidates[0];
    IntPtr active = GetForegroundWindow();
    foreach (IntPtr candidate in candidates) if (candidate == active) return candidate;
    throw new ArgumentException("window target is ambiguous; use pid: or hwnd: " + selector);
  }

  /**
   * Focus and verify a top-level target. Input guards refuse to restore a
   * minimized target because restoring changes geometry and invalidates prior
   * screenshot coordinates. Explicit focus may restore it; the caller then
   * receives a fresh screenshot before taking coordinate actions.
   */
  public static string FocusWindow(string selector, bool allowRestore) {
    IntPtr hWnd = ResolveWindow(selector);
    bool restored = false;
    if (IsIconic(hWnd)) {
      if (!allowRestore) {
        throw new InvalidOperationException("target window is minimized; call focus, inspect the fresh screenshot, then retry the input action");
      }
      ShowWindowAsync(hWnd, SW_RESTORE);
      restored = true;
      Thread.Sleep(120);
    }

    IntPtr foreground = GetForegroundWindow();
    uint ignored;
    uint targetThread = GetWindowThreadProcessId(hWnd, out ignored);
    uint currentThread = GetCurrentThreadId();
    uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out ignored);
    bool attachedTarget = false;
    bool attachedForeground = false;
    try {
      if (targetThread != 0 && targetThread != currentThread) {
        attachedTarget = AttachThreadInput(currentThread, targetThread, true);
      }
      if (foregroundThread != 0 && foregroundThread != currentThread && foregroundThread != targetThread) {
        attachedForeground = AttachThreadInput(currentThread, foregroundThread, true);
      }
      BringWindowToTop(hWnd);
      SetForegroundWindow(hWnd);
    } finally {
      if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
      if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
    }

    Thread.Sleep(100);
    if (GetForegroundWindow() != hWnd) {
      throw new InvalidOperationException("failed to focus target window; foreground is " + DescribeWindow(GetForegroundWindow()));
    }
    return DescribeWindow(hWnd) + " restored=" + restored.ToString().ToLowerInvariant();
  }

  private static void GuardTarget(string selector) {
    if (!String.IsNullOrWhiteSpace(selector)) FocusWindow(selector, false);
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

  public static void Guard(string selector) {
    GuardTarget(selector);
  }

  public static string ForegroundSummary() {
    return DescribeWindow(GetForegroundWindow());
  }
}
"@

Add-Type -TypeDefinition $source -Language CSharp
[PhoenixDesktop]::EnableDpiAwareness()
$action = $env:PHX_ACTION
$button = if ($env:PHX_BUTTON) { $env:PHX_BUTTON } else { 'left' }
$target = $env:PHX_TARGET

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
  'windows' { [PhoenixDesktop]::ListWindows() }
  'focus' { [PhoenixDesktop]::FocusWindow($target, $true) }
  'move' {
    [PhoenixDesktop]::Guard($target)
    [PhoenixDesktop]::Move([int]$env:PHX_X, [int]$env:PHX_Y)
    [PhoenixDesktop]::ForegroundSummary()
  }
  'click' {
    [PhoenixDesktop]::Guard($target)
    [PhoenixDesktop]::Click([int]$env:PHX_X, [int]$env:PHX_Y, $button, 1)
    [PhoenixDesktop]::ForegroundSummary()
  }
  'double_click' {
    [PhoenixDesktop]::Guard($target)
    [PhoenixDesktop]::Click([int]$env:PHX_X, [int]$env:PHX_Y, $button, 2)
    [PhoenixDesktop]::ForegroundSummary()
  }
  'drag' {
    [PhoenixDesktop]::Guard($target)
    [PhoenixDesktop]::Drag([int]$env:PHX_X, [int]$env:PHX_Y, [int]$env:PHX_X2, [int]$env:PHX_Y2, $button)
    [PhoenixDesktop]::ForegroundSummary()
  }
  'type' {
    [PhoenixDesktop]::Guard($target)
    [PhoenixDesktop]::TypeText($env:PHX_TEXT)
    [PhoenixDesktop]::ForegroundSummary()
  }
  'key' {
    [PhoenixDesktop]::Guard($target)
    [PhoenixDesktop]::KeyCombo($env:PHX_KEYS)
    [PhoenixDesktop]::ForegroundSummary()
  }
  'scroll' {
    [PhoenixDesktop]::Guard($target)
    if ($env:PHX_X -and $env:PHX_Y) { [PhoenixDesktop]::Move([int]$env:PHX_X, [int]$env:PHX_Y) }
    [PhoenixDesktop]::Scroll([int]$env:PHX_DELTA)
    [PhoenixDesktop]::ForegroundSummary()
  }
  default { throw "unsupported PHX_ACTION: $action" }
}
`

function putNumber(env: Record<string, string>, key: string, value: number | undefined): void {
  if (value !== undefined) env[key] = String(value)
}

/**
 * Build the injection-safe native invocation; model strings travel only as environment values.
 * The fixed driver is streamed over stdin so its size never consumes the Windows command-line budget.
 * @param args - Validated model-facing Computer Use arguments.
 * @returns Fixed PowerShell executable/argv, isolated environment values, and fixed stdin driver source.
 */
export function windowsComputerInvocation(args: ComputerToolArgs): ComputerInvocation {
  validateComputerArgs(args)
  const env: Record<string, string> = { PHX_ACTION: args.action }
  putNumber(env, 'PHX_X', args.x)
  putNumber(env, 'PHX_Y', args.y)
  putNumber(env, 'PHX_X2', args.x2)
  putNumber(env, 'PHX_Y2', args.y2)
  putNumber(env, 'PHX_DELTA', args.delta)
  if (args.target !== undefined) env.PHX_TARGET = args.target
  if (args.button !== undefined) env.PHX_BUTTON = args.button
  if (args.text !== undefined) env.PHX_TEXT = args.text
  if (args.keys !== undefined) env.PHX_KEYS = args.keys
  return {
    file: 'powershell.exe',
    argv: ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', '-'],
    env,
    // Windows PowerShell executes a multi-line stdin command only after the blank
    // line that terminates its final compound statement.
    stdin: `${WINDOWS_DRIVER}\n`,
  }
}

function executeComputerInvocation(invocation: ComputerInvocation, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(invocation.file, [...invocation.argv], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...invocation.env },
      ...signal === undefined ? {} : { signal },
    }, (error, stdout) => {
      if (error !== null) {
        reject(error instanceof Error ? error : new Error('Computer Use process failed', { cause: error }))
        return
      }
      resolve(stdout.trim())
    })

    if (child.stdin === null) {
      child.kill()
      reject(new Error('Computer Use PowerShell process did not expose stdin'))
      return
    }

    child.stdin.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'EPIPE') return
      child.kill()
      reject(error)
    })
    child.stdin.end(invocation.stdin, 'utf8')
  })
}

/**
 * Execute one fixed Windows desktop action and return driver stdout.
 * @param args - Validated Computer Use operation to execute.
 * @param signal - Optional cancellation signal forwarded to the PowerShell process.
 * @returns Trimmed stdout; screenshots return base64 PNG bytes.
 */
export async function runWindowsComputerAction(args: ComputerToolArgs, signal?: AbortSignal): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error(`Computer Use Windows driver is unavailable on ${process.platform}`)
  }
  signal?.throwIfAborted()
  const invocation = windowsComputerInvocation(args)
  return await executeComputerInvocation(invocation, signal)
}

function inputRisk(action: ComputerAction): { risk: 'low' | 'medium' | 'high'; reversible: boolean } {
  if (action === 'move' || action === 'scroll' || action === 'focus') return { risk: 'low', reversible: true }
  if (action === 'click' || action === 'double_click' || action === 'drag') return { risk: 'medium', reversible: false }
  return { risk: 'high', reversible: false }
}

async function authorizeComputerAction(
  ctx: Context,
  exec: ToolRunContext,
  action: ComputerAction,
  sandboxMode: SandboxMode | undefined,
): Promise<void> {
  const mode = computerModeForSandbox(sandboxMode)
  assertComputerActionAllowed(mode, action)
  if (action === 'screenshot' || action === 'windows' || sandboxMode === 'danger-full-access') return
  const agent = exec.agent
  if (agent === undefined) throw new Error('Computer input requires an owning agent session')
  const approval = ctx.get('approval')
  if (approval === undefined) throw new Error('Computer input requires the approval service; refusing action')
  const risk = inputRisk(action)
  const outcome = await approval.request({
    agent,
    toolName: 'computer',
    callId: exec.callId,
    reason: `Allow PHOENIX to perform desktop ${action.replace('_', ' ')}?`,
    risk: risk.risk,
    reversible: risk.reversible,
    signal: exec.signal,
  })
  if (outcome !== 'allowed-once') {
    throw new Error(`Computer action "${action}" was not approved (${outcome}).`)
  }
}

/**
 * Wait for desktop state to settle and release cancellation listeners on every completion path.
 * @param ms - Milliseconds to wait before the next observation.
 * @param signal - Optional action cancellation signal.
 * @returns A promise that resolves after the delay or rejects when cancelled.
 */
export function waitForComputerSettle(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) return new Promise(resolve => setTimeout(resolve, ms))
  const abortError = (): Error => signal.reason instanceof Error
    ? signal.reason
    : new Error('Computer action aborted', { cause: signal.reason })
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function attachDesktopScreenshot(
  ctx: Context,
  exec: ToolRunContext,
  base64Png: string,
  label: string,
): Promise<void> {
  if (exec.agent === undefined) throw new Error('Computer screenshot requires an owning agent session')
  if (base64Png.length === 0) throw new Error('Computer screenshot driver returned no image bytes')
  const bytes = Buffer.from(base64Png, 'base64')
  if (bytes.length === 0) throw new Error('Computer screenshot decoded to an empty image')
  const attachments = attachmentWriter(ctx)
  if (attachments === undefined) throw new Error('Computer screenshot requires the attachment service')
  const attachment = await attachments.saveImage({
    data: bytes,
    mediaType: 'image/png',
    name: 'phoenix-desktop.png',
  })
  const imageBlock = { type: 'image', attachment } as unknown as ContentBlock
  exec.deferContext(createUserMessage({
    content: [
      {
        type: 'text',
        text: `${label} (${attachment.width}x${attachment.height}). Treat this fresh observation as the source of truth; do not infer success from input injection alone.`,
      },
      imageBlock,
    ],
    source: { kind: 'plugin', plugin: 'computer-use' },
  }))
}

/**
 * Build the Windows Computer Use definition without executing desktop operations.
 * @param ctx - PHOENIX composition carrying tools, shell policy, and optional attachments/approval capabilities.
 * @returns Tool definition for runtime registration or platform-independent schema collection.
 */
export function createComputerTool(ctx: Context): ToolDefinition {
  const sandboxPolicy: SandboxPolicyService | undefined = ctx.get('sandboxPolicy')
  const deploymentDefault = ctx.shell.sandboxMode

  return defineTool({
    name: 'computer',
    description: 'Control the Windows desktop with window-aware actions. Before controlling an external application, prefer windows -> focus(target) -> screenshot, then act. target may be a visible title/title substring, pid:1234, or hwnd:0x123ABC; when supplied, PHOENIX verifies that target is foreground before injecting input. A minimized target is never clicked from stale coordinates: call focus first, inspect its automatic fresh screenshot, then act. State-changing actions automatically attach a fresh post-action screenshot. Treat that screenshot as the source of truth and verify the visible outcome before the next action; status ok means the OS accepted the tool operation, not that the application-level goal succeeded. read-only is observe-only; workspace-write uses normal approval; danger-full-access is no-prompt desktop authority.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['screenshot', 'windows', 'focus', 'move', 'click', 'double_click', 'drag', 'type', 'key', 'scroll'],
        description: 'Desktop operation. windows lists visible top-level windows; focus activates a target and verifies foreground identity.',
      },
      target: { type: 'string', description: 'Top-level window selector: title/title substring, pid:1234, or hwnd:0x123ABC. Required for focus and strongly recommended for external-app input.' },
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
          details: { type: 'string' },
          postScreenshot: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.action === 'windows'
          ? `Visible top-level windows:\n${value.details ?? '<none>'}`
          : value.action === 'screenshot'
            ? 'Desktop screenshot captured and attached for the next model step.'
            : value.postScreenshot
              ? `Desktop ${value.action} input sent and a fresh post-action screenshot was attached. Verify the visible result before proceeding.`
              : `Desktop ${value.action} input sent.`,
      }],
    },
    async execute(args: ComputerToolArgs, exec) {
      validateComputerArgs(args)
      const session = exec.agent?.session
      const policy = sandboxPolicy?.resolve(session === undefined ? {} : { session })
      const sandboxMode = policy?.mode ?? deploymentDefault
      await authorizeComputerAction(ctx, exec, args.action, sandboxMode)

      const output = await runWindowsComputerAction(args, exec.signal)
      let postScreenshot = false

      if (args.action === 'screenshot') {
        await attachDesktopScreenshot(ctx, exec, output, 'PHOENIX desktop screenshot')
        postScreenshot = true
      } else if (shouldCaptureAfterAction(args.action)) {
        await waitForComputerSettle(POST_ACTION_SETTLE_MS, exec.signal)
        const fresh = await runWindowsComputerAction({ action: 'screenshot' }, exec.signal)
        await attachDesktopScreenshot(ctx, exec, fresh, `PHOENIX post-${args.action} desktop screenshot`)
        postScreenshot = true
      }

      return {
        action: args.action,
        status: 'ok' as const,
        ...output.length > 0 && args.action !== 'screenshot' ? { details: output } : {},
        postScreenshot,
      }
    },
  })
}

/**
 * Register the model-facing Computer Use tool on Windows compositions.
 * @param ctx - PHOENIX composition carrying the tool runtime.
 */
export function registerComputerTool(ctx: Context): void {
  if (process.platform !== 'win32') return
  ctx.tools.register(createComputerTool(ctx))
}
