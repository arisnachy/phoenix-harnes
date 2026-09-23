using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

namespace Phoenix.Desktop;

/// <summary>
/// Resident Win32 implementation for Computer actions. It is owned by Phoenix Desktop, so the
/// hot path does not start PowerShell or compile a C# driver for each operation.
/// </summary>
internal static class DesktopComputerDriver
{
    private const uint MouseEventLeftDown = 0x0002;
    private const uint MouseEventLeftUp = 0x0004;
    private const uint MouseEventRightDown = 0x0008;
    private const uint MouseEventRightUp = 0x0010;
    private const uint MouseEventMiddleDown = 0x0020;
    private const uint MouseEventMiddleUp = 0x0040;
    private const uint MouseEventWheel = 0x0800;
    private const uint KeyEventKeyUp = 0x0002;
    private const uint KeyEventUnicode = 0x0004;
    private const uint InputKeyboard = 1;
    private const int ShowWindowRestore = 9;

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extraInfo);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] inputs, int size);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint sourceThread, uint targetThread, bool attach);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out Rect rect);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int DeltaX;
        public int DeltaY;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort VirtualKey;
        public ushort ScanCode;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HardwareInput
    {
        public uint Message;
        public ushort ParameterLow;
        public ushort ParameterHigh;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MouseInput Mouse;
        [FieldOffset(0)] public KeyboardInput Keyboard;
        [FieldOffset(0)] public HardwareInput Hardware;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Input
    {
        public uint Type;
        public InputUnion Union;
    }

    internal sealed record Result(string? Details, string? ScreenshotBase64);

    internal static Result Execute(DesktopComputerRequest request)
    {
        if (request.Type == "screenshot")
            return new Result(null, CaptureScreenshot());

        string? screenshot = null;
        var details = request.Type switch
        {
            "windows" => ListWindows(out screenshot),
            "focus" => FocusWindow(request.Target!, allowRestore: true, out screenshot),
            "move" => Move(request, out screenshot),
            "click" => Click(request, count: 1, out screenshot),
            "double_click" => Click(request, count: 2, out screenshot),
            "drag" => Drag(request, out screenshot),
            "type" => TypeText(request, out screenshot),
            "key" => KeyCombo(request, out screenshot),
            "scroll" => Scroll(request, out screenshot),
            _ => throw new InvalidOperationException($"Unsupported resident Computer action: {request.Type}"),
        };

        if (request.Capture)
            return new Result(details, CaptureScreenshot());
        return new Result(details, null);
    }

    internal static string CaptureScreenshot()
    {
        var bounds = SystemInformation.VirtualScreen;
        if (bounds.Width <= 0 || bounds.Height <= 0)
            throw new InvalidOperationException("Desktop has no capturable virtual screen.");

        using var bitmap = new Bitmap(bounds.Width, bounds.Height);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bitmap.Size, CopyPixelOperation.SourceCopy);
        using var stream = new MemoryStream();
        bitmap.Save(stream, ImageFormat.Png);
        return Convert.ToBase64String(stream.ToArray());
    }

    private static string ListWindows(out string? screenshot)
    {
        screenshot = null;
        var lines = new List<string>();
        EnumWindows((window, _) =>
        {
            if (IsWindowVisible(window) && WindowTitle(window).Length > 0)
                lines.Add(DescribeWindow(window));
            return true;
        }, IntPtr.Zero);
        return lines.Count == 0 ? "<no visible top-level windows>" : string.Join(Environment.NewLine, lines);
    }

    private static string Move(DesktopComputerRequest request, out string? screenshot)
    {
        screenshot = null;
        GuardTarget(request.Target);
        MoveCursor(request.X!.Value, request.Y!.Value);
        return ForegroundSummary();
    }

    private static string Click(DesktopComputerRequest request, int count, out string? screenshot)
    {
        screenshot = null;
        GuardTarget(request.Target);
        MoveCursor(request.X!.Value, request.Y!.Value);
        var flags = ButtonFlags(request.Button);
        for (var index = 0; index < count; index++)
        {
            mouse_event(flags.Down, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(35);
            mouse_event(flags.Up, 0, 0, 0, UIntPtr.Zero);
            if (index + 1 < count) Thread.Sleep(70);
        }
        return ForegroundSummary();
    }

    private static string Drag(DesktopComputerRequest request, out string? screenshot)
    {
        screenshot = null;
        GuardTarget(request.Target);
        MoveCursor(request.X!.Value, request.Y!.Value);
        var flags = ButtonFlags(request.Button);
        mouse_event(flags.Down, 0, 0, 0, UIntPtr.Zero);
        try
        {
            const int steps = 12;
            for (var index = 1; index <= steps; index++)
            {
                var x = request.X!.Value + ((request.X2!.Value - request.X.Value) * index / steps);
                var y = request.Y!.Value + ((request.Y2!.Value - request.Y.Value) * index / steps);
                MoveCursor(x, y);
                Thread.Sleep(18);
            }
        }
        finally
        {
            mouse_event(flags.Up, 0, 0, 0, UIntPtr.Zero);
        }
        return ForegroundSummary();
    }

    private static string TypeText(DesktopComputerRequest request, out string? screenshot)
    {
        screenshot = null;
        GuardTarget(request.Target);
        foreach (var character in request.Text ?? string.Empty)
        {
            var inputs = new[]
            {
                new Input
                {
                    Type = InputKeyboard,
                    Union = new InputUnion { Keyboard = new KeyboardInput { ScanCode = character, Flags = KeyEventUnicode } },
                },
                new Input
                {
                    Type = InputKeyboard,
                    Union = new InputUnion { Keyboard = new KeyboardInput { ScanCode = character, Flags = KeyEventUnicode | KeyEventKeyUp } },
                },
            };
            if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Input>()) != inputs.Length)
                throw new InvalidOperationException("SendInput failed while typing text.");
        }
        return ForegroundSummary();
    }

    private static string KeyCombo(DesktopComputerRequest request, out string? screenshot)
    {
        screenshot = null;
        GuardTarget(request.Target);
        var codes = (request.Keys ?? string.Empty)
            .Split('+', StringSplitOptions.RemoveEmptyEntries)
            .Select(KeyCode)
            .ToArray();
        if (codes.Length == 0) throw new ArgumentException("Empty key combo.");
        foreach (var code in codes) keybd_event(code, 0, 0, UIntPtr.Zero);
        Thread.Sleep(25);
        for (var index = codes.Length - 1; index >= 0; index--)
            keybd_event(codes[index], 0, KeyEventKeyUp, UIntPtr.Zero);
        return ForegroundSummary();
    }

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

    private static string Scroll(DesktopComputerRequest request, out string? screenshot)
    {
        screenshot = null;
        GuardTarget(request.Target);
        if (request.X is not null && request.Y is not null) MoveCursor(request.X.Value, request.Y.Value);
        mouse_event(MouseEventWheel, 0, 0, request.Delta!.Value, UIntPtr.Zero);
        return ForegroundSummary();
    }

    private static string FocusWindow(string selector, bool allowRestore, out string? screenshot)
    {
        screenshot = null;
        var window = ResolveWindow(selector);
        var restored = false;
        if (IsIconic(window))
        {
            if (!allowRestore)
                throw new InvalidOperationException("Target window is minimized; call focus before retrying input.");
            ShowWindowAsync(window, ShowWindowRestore);
            restored = true;
            Thread.Sleep(120);
        }

        var foreground = GetForegroundWindow();
        GetWindowThreadProcessId(window, out _);
        var targetThread = GetWindowThreadProcessId(window, out _);
        var currentThread = GetCurrentThreadId();
        var foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out _);
        var attachedTarget = false;
        var attachedForeground = false;
        try
        {
            if (targetThread != 0 && targetThread != currentThread)
                attachedTarget = AttachThreadInput(currentThread, targetThread, true);
            if (foregroundThread != 0 && foregroundThread != currentThread && foregroundThread != targetThread)
                attachedForeground = AttachThreadInput(currentThread, foregroundThread, true);
            BringWindowToTop(window);
            SetForegroundWindow(window);
        }
        finally
        {
            if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
            if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
        }

        Thread.Sleep(100);
        if (GetForegroundWindow() != window)
            throw new InvalidOperationException($"Failed to focus target window; foreground is {DescribeWindow(GetForegroundWindow())}.");
        return DescribeWindow(window) + $" restored={restored.ToString().ToLowerInvariant()}";
    }

    private static void GuardTarget(string? selector)
    {
        if (!string.IsNullOrWhiteSpace(selector)) _ = FocusWindow(selector, allowRestore: false, out _);
    }

    private static void MoveCursor(int x, int y)
    {
        if (!SetCursorPos(x, y)) throw new InvalidOperationException("SetCursorPos failed.");
    }

    private static (uint Down, uint Up) ButtonFlags(string? button) => (button ?? "left").ToLowerInvariant() switch
    {
        "left" => (MouseEventLeftDown, MouseEventLeftUp),
        "right" => (MouseEventRightDown, MouseEventRightUp),
        "middle" => (MouseEventMiddleDown, MouseEventMiddleUp),
        _ => throw new ArgumentException($"Unsupported mouse button: {button}"),
    };

    private static IntPtr ResolveWindow(string selector)
    {
        var wanted = selector.Trim();
        if (wanted.StartsWith("hwnd:", StringComparison.OrdinalIgnoreCase))
        {
            var value = wanted[5..];
            var parsed = value.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
                ? Convert.ToInt64(value[2..], 16)
                : long.Parse(value);
            var window = new IntPtr(parsed);
            if (!IsWindow(window)) throw new ArgumentException($"Window handle does not exist: {selector}");
            return window;
        }

        var candidates = new List<IntPtr>();
        EnumWindows((window, _) =>
        {
            if (!IsWindowVisible(window)) return true;
            var title = WindowTitle(window);
            if (wanted.StartsWith("pid:", StringComparison.OrdinalIgnoreCase)
                && uint.TryParse(wanted[4..].Trim(), out var pid))
            {
                GetWindowThreadProcessId(window, out var windowPid);
                if (windowPid == pid && title.Length > 0) candidates.Add(window);
            }
            else if (title.Equals(wanted, StringComparison.OrdinalIgnoreCase)
                || title.Contains(wanted, StringComparison.OrdinalIgnoreCase))
            {
                candidates.Add(window);
            }
            return true;
        }, IntPtr.Zero);
        if (candidates.Count == 0) throw new ArgumentException($"No visible window matches target: {selector}");
        if (candidates.Count == 1) return candidates[0];
        var foreground = GetForegroundWindow();
        return candidates.FirstOrDefault(candidate => candidate == foreground) is var selected && selected != IntPtr.Zero
            ? selected
            : throw new ArgumentException($"Window target is ambiguous; use pid: or hwnd: {selector}");
    }

    private static string ForegroundSummary() => DescribeWindow(GetForegroundWindow());

    private static string DescribeWindow(IntPtr window)
    {
        if (window == IntPtr.Zero || !IsWindow(window)) return "hwnd=0x0 active=false title=<none>";
        GetWindowThreadProcessId(window, out var pid);
        var bounds = GetWindowRect(window, out var rect)
            ? $" bounds={rect.Left},{rect.Top},{rect.Right},{rect.Bottom}"
            : string.Empty;
        var active = GetForegroundWindow() == window;
        return $"hwnd=0x{window.ToInt64():X} pid={pid} active={active.ToString().ToLowerInvariant()}{bounds} title={WindowTitle(window)}";
    }

    private static string WindowTitle(IntPtr window)
    {
        var length = GetWindowTextLength(window);
        if (length <= 0) return string.Empty;
        var text = new StringBuilder(length + 1);
        GetWindowText(window, text, text.Capacity);
        return text.ToString().Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ').Trim();
    }

    private static byte KeyCode(string token)
    {
        var key = token.Trim().ToUpperInvariant();
        var named = new Dictionary<string, byte>(StringComparer.Ordinal)
        {
            ["CTRL"] = 0x11, ["CONTROL"] = 0x11, ["ALT"] = 0x12, ["SHIFT"] = 0x10,
            ["WIN"] = 0x5B, ["META"] = 0x5B, ["ENTER"] = 0x0D, ["RETURN"] = 0x0D,
            ["ESC"] = 0x1B, ["ESCAPE"] = 0x1B, ["TAB"] = 0x09, ["BACKSPACE"] = 0x08,
            ["DELETE"] = 0x2E, ["UP"] = 0x26, ["DOWN"] = 0x28, ["LEFT"] = 0x25,
            ["RIGHT"] = 0x27, ["HOME"] = 0x24, ["END"] = 0x23, ["PAGEUP"] = 0x21,
            ["PAGEDOWN"] = 0x22, ["SPACE"] = 0x20,
        };
        if (named.TryGetValue(key, out var code)) return code;
        if (key.Length == 1 && ((key[0] >= 'A' && key[0] <= 'Z') || (key[0] >= '0' && key[0] <= '9')))
            return (byte)key[0];
        if (key.StartsWith('F') && int.TryParse(key[1..], out var number) && number is >= 1 and <= 24)
            return (byte)(0x70 + number - 1);
        throw new ArgumentException($"Unsupported key: {token}");
    }
}
