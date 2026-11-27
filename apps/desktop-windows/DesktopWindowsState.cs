using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace Phoenix.Desktop;

/// <summary>Resident Windows event and power sensor. No titles, keystrokes, pixels, or event history.</summary>
internal sealed class DesktopWindowsState : IDisposable
{
    private const uint Foreground = 0x0003, MinimizeStart = 0x0016, MinimizeEnd = 0x0017;
    private const uint ObjectShow = 0x8002, ObjectHide = 0x8003, LocationChange = 0x800B;
    private const uint RootAncestor = 2;
    private delegate void WinEventCallback(IntPtr hook, uint eventType, IntPtr hwnd, int objectId, int childId, uint thread, uint eventTime);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventCallback callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr hwnd);

    private readonly List<IntPtr> hooks = new();
    private readonly WinEventCallback callback;
    private bool started, disposed;
    private long revision, foregroundChanges, visibilityChanges, geometryChanges, minimizeChanges;
    private long? lastEventAt;

    internal DesktopWindowsState() => callback = OnEvent;

    /// <summary>Call on the owning WinForms message-loop thread; dispose on that same thread.</summary>
    internal void Start()
    {
        if (started || disposed) return;
        started = true;
        foreach (var (min, max) in new[] {
            (Foreground, Foreground), (MinimizeStart, MinimizeEnd),
            (ObjectShow, ObjectHide), (LocationChange, LocationChange)
        })
        {
            // WINEVENT_OUTOFCONTEXT = 0: no DLL injection into other applications.
            var hook = SetWinEventHook(min, max, IntPtr.Zero, callback, 0, 0, 0);
            if (hook != IntPtr.Zero) hooks.Add(hook);
        }
    }

    private void OnEvent(IntPtr hook, uint type, IntPtr hwnd, int objectId, int childId, uint thread, uint eventTime)
    {
        if (disposed || hwnd == IntPtr.Zero || objectId != 0 || childId != 0) return;
        if (GetAncestor(hwnd, RootAncestor) != hwnd) return;
        switch (type)
        {
            case Foreground: foregroundChanges++; break;
            case ObjectShow:
            case ObjectHide: visibilityChanges++; break;
            case LocationChange: geometryChanges++; break;
            case MinimizeStart:
            case MinimizeEnd: minimizeChanges++; break;
            default: return;
        }
        revision++;
        lastEventAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    internal string Snapshot()
    {
        string? processName = null;
        bool? minimized = null;
        var hwnd = GetForegroundWindow();
        if (hwnd != IntPtr.Zero)
        {
            try
            {
                GetWindowThreadProcessId(hwnd, out var pid);
                using var process = Process.GetProcessById(checked((int)pid));
                processName = process.ProcessName;
                if (processName.Length > 100) processName = processName[..100];
                minimized = IsIconic(hwnd);
            }
            catch { /* Window/process may have exited. Never report a guessed identity. */ }
        }
        var power = System.Windows.Forms.SystemInformation.PowerStatus;
        var batteryStatus = power.BatteryChargeStatus;
        bool? batteryPresent = batteryStatus == System.Windows.Forms.BatteryChargeStatus.Unknown
            ? null : !batteryStatus.HasFlag(System.Windows.Forms.BatteryChargeStatus.NoSystemBattery);
        int? batteryPercent = batteryPresent == true && power.BatteryLifePercent is >= 0 and <= 1
            ? (int)Math.Round(power.BatteryLifePercent * 100) : null;
        return JsonSerializer.Serialize(new
        {
            schema = "phoenix.windows-state.v1",
            observedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            events = new { status = hooks.Count == 4 ? "active" : hooks.Count > 0 ? "partial" : "unavailable",
                revision, lastEventAt, foregroundChanges, visibilityChanges, geometryChanges, minimizeChanges },
            foreground = new { processName, minimized },
            power = new { line = power.PowerLineStatus.ToString(), batteryPresent, batteryPercent },
            historyStored = false, contentCaptured = false, permissionsGranted = false
        });
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        foreach (var hook in hooks) _ = UnhookWinEvent(hook);
        hooks.Clear();
        GC.KeepAlive(callback);
    }
}
