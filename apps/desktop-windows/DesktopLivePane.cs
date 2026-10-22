using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace Phoenix.Desktop;

/// <summary>
/// Opt-in visible companion to the existing browser pane. This viewer never
/// sends input: the Computer tool's sandbox/approval policy remains authoritative.
/// PrintWindow captures a selected application even when the chat has focus.
/// </summary>
internal sealed class DesktopLivePane : UserControl
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder title, int maxCount);
    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out NativeRect rect);
    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);

    private readonly PictureBox image = new() { Dock = DockStyle.Fill, SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.FromArgb(21, 29, 42) };
    private readonly ToolStripLabel status = new("Desktop Live · sin ventana");
    private readonly ToolStripButton pause = new("Pausar") { ToolTipText = "Impide nuevas acciones del modelo mientras esté pausado" };
    private readonly System.Windows.Forms.Timer refresh = new() { Interval = 850 };
    private string? selectedTarget;
    private string? ownerSession;
    private DateTimeOffset ownerLastAction = DateTimeOffset.MinValue;

    internal bool IsPaused { get; private set; }
    internal bool IsDismissed { get; private set; }
    internal event EventHandler? CloseRequested;

    internal DesktopLivePane()
    {
        var bar = new ToolStrip { Dock = DockStyle.Top, GripStyle = ToolStripGripStyle.Hidden };
        var close = new ToolStripButton("×") { Alignment = ToolStripItemAlignment.Right, ToolTipText = "Ocultar Desktop Live; Ctrl+F10 lo reabre" };
        pause.Click += (_, _) =>
        {
            IsPaused = !IsPaused;
            pause.Text = IsPaused ? "Reanudar" : "Pausar";
            status.Text = IsPaused ? "Desktop Live · pausado por usuario" : "Desktop Live · control activo";
        };
        close.Click += (_, _) =>
        {
            IsDismissed = true;
            CloseRequested?.Invoke(this, EventArgs.Empty);
        };
        bar.Items.Add(status);
        bar.Items.Add(pause);
        bar.Items.Add(close);
        Controls.Add(image);
        Controls.Add(bar);
        refresh.Tick += (_, _) => CaptureSelectedWindow();
        Disposed += (_, _) =>
        {
            refresh.Stop();
            refresh.Dispose();
            image.Image?.Dispose();
        };
    }

    internal void AssertSessionAccess(string? sessionId, bool observe)
    {
        if (!observe && IsPaused)
            throw new InvalidOperationException("Desktop Live paused by user; resume from the native toolbar.");
        if (sessionId is null) return; // Direct human Ctrl+F10 reopen, never a model call.
        if (!observe && ownerSession is not null
            && !string.Equals(ownerSession, sessionId, StringComparison.Ordinal)
            && DateTimeOffset.UtcNow - ownerLastAction < TimeSpan.FromSeconds(30))
            throw new InvalidOperationException("Desktop Live occupied by another session; retry after its lease expires.");
        if (!observe || ownerSession is null)
        {
            ownerSession = sessionId;
            ownerLastAction = DateTimeOffset.UtcNow;
        }
    }

    internal void Open(string? target, string? sessionId)
    {
        if (!string.IsNullOrWhiteSpace(target)) selectedTarget = target.Trim();
        Visible = true;
        CaptureSelectedWindow();
        refresh.Start();
    }

    internal void HideForBrowser()
    {
        refresh.Stop();
        Visible = false;
    }

    internal void ResetDismissal()
    {
        IsDismissed = false;
    }

    private static string WindowTitle(IntPtr handle)
    {
        var size = GetWindowTextLength(handle);
        if (size <= 0) return string.Empty;
        var buffer = new StringBuilder(size + 1);
        _ = GetWindowText(handle, buffer, buffer.Capacity);
        return buffer.ToString();
    }

    private IntPtr ResolveTargetWindow()
    {
        if (!string.IsNullOrEmpty(selectedTarget))
        {
            IntPtr chosen = IntPtr.Zero;
            var target = selectedTarget;
            _ = EnumWindows((window, _) =>
            {
                if (!IsWindowVisible(window) || GetWindowThreadProcessId(window, out var pid) == 0)
                    return true;
                if (pid == Environment.ProcessId) return true;
                var match = false;
                if (target.StartsWith("pid:", StringComparison.OrdinalIgnoreCase))
                    match = uint.TryParse(target.AsSpan(4), out var requestedPid) && pid == requestedPid;
                else if (target.StartsWith("hwnd:0x", StringComparison.OrdinalIgnoreCase))
                    match = long.TryParse(target.AsSpan(7), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var handle)
                        && window.ToInt64() == handle;
                else
                    match = WindowTitle(window).Contains(target, StringComparison.OrdinalIgnoreCase);
                if (!match) return true;
                chosen = window;
                return false;
            }, IntPtr.Zero);
            return chosen;
        }

        var foreground = GetForegroundWindow();
        if (foreground == IntPtr.Zero || !IsWindow(foreground)) return IntPtr.Zero;
        GetWindowThreadProcessId(foreground, out var foregroundPid);
        // Do not recursively capture the Phoenix chat instead of the requested app.
        return foregroundPid == Environment.ProcessId ? IntPtr.Zero : foreground;
    }

    private void CaptureSelectedWindow()
    {
        if (IsDisposed || !Visible) return;
        var hwnd = ResolveTargetWindow();
        if (hwnd == IntPtr.Zero)
        {
            status.Text = "Desktop Live · selecciona una ventana con computer focus";
            return;
        }
        if (IsIconic(hwnd))
        {
            status.Text = "Desktop Live · ventana minimizada; activa la aplicación";
            return;
        }
        if (!GetWindowRect(hwnd, out var bounds))
        {
            status.Text = "Desktop Live · no se pudo localizar la ventana";
            return;
        }
        var width = bounds.Right - bounds.Left;
        var height = bounds.Bottom - bounds.Top;
        if (width <= 0 || height <= 0 || (long)width * height > 16_000_000)
        {
            status.Text = "Desktop Live · dimensiones de ventana no compatibles";
            return;
        }
        using var frame = new Bitmap(width, height);
        using (var graphics = Graphics.FromImage(frame))
        {
            var hdc = graphics.GetHdc();
            bool captured;
            try { captured = PrintWindow(hwnd, hdc, 2); }
            finally { graphics.ReleaseHdc(hdc); }
            if (!captured)
            {
                status.Text = "Desktop Live · la aplicación no permite captura nativa";
                return;
            }
        }
        var previous = image.Image;
        image.Image = (Bitmap)frame.Clone();
        previous?.Dispose();
        status.Text = $"Desktop Live · {WindowTitle(hwnd)}";
    }
}
