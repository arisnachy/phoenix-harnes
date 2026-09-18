using System.Diagnostics;
using System.Drawing;
using System.Net.Http;
using Microsoft.Win32;

namespace Phoenix.Desktop;

internal static class Program
{
    internal static readonly Uri PhoenixUri = new("http://127.0.0.1:3080/");
    internal static readonly string InstallRoot = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Phoenix");
    internal static readonly string RuntimeRoot = Path.Combine(InstallRoot, "runtime");
    internal static readonly string LogPath = Path.Combine(InstallRoot, "logs", "desktop.log");

    private const string MutexName = "Local\\PhoenixDesktop.SingleInstance.v2";
    private const string ShowEventName = "Local\\PhoenixDesktop.ShowWindow.v2";

    [STAThread]
    private static void Main(string[] args)
    {
        try
        {
            MainCore(args);
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Fatal desktop startup failure", ex);
            try
            {
                MessageBox.Show(
                    $"Phoenix no pudo iniciar.\n\n{ex.Message}\n\nDiagnóstico: {LogPath}",
                    "Phoenix · error de inicio",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            catch
            {
                // Logging is the final fallback if WinForms itself cannot show the message.
            }
        }
    }

    private static void MainCore(string[] args)
    {
        DesktopLog.Write($"Phoenix.exe starting. Args: {string.Join(' ', args)}");

        if (args.Contains("--enable-autostart", StringComparer.OrdinalIgnoreCase))
        {
            StartupRegistration.SetEnabled(true);
            return;
        }
        if (args.Contains("--disable-autostart", StringComparer.OrdinalIgnoreCase))
        {
            StartupRegistration.SetEnabled(false);
            return;
        }
        if (args.Contains("--smoke-window", StringComparer.OrdinalIgnoreCase))
        {
            RunVisibleWindowSmokeTest();
            return;
        }

        using var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
        using var mutex = new Mutex(initiallyOwned: true, MutexName, out var ownsMutex);
        if (!ownsMutex)
        {
            DesktopLog.Write("Second launch detected; signaling the existing Phoenix window.");
            showEvent.Set();
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new PhoenixApplicationContext(showEvent));
    }

    private static void RunVisibleWindowSmokeTest()
    {
        DesktopLog.Write("Visible smoke: initializing WinForms.");
        ApplicationConfiguration.Initialize();
        using var window = new PhoenixDesktopWindow(PhoenixUri, initializeWebViewsOnShow: false)
        {
            WindowState = FormWindowState.Normal,
            Size = new Size(1100, 760),
        };
        using var timer = new System.Windows.Forms.Timer { Interval = 1200 };
        var shown = false;

        window.HandleCreated += (_, _) => DesktopLog.Write("Visible smoke: HandleCreated.");
        window.Load += (_, _) => DesktopLog.Write("Visible smoke: Load.");
        window.Shown += (_, _) =>
        {
            shown = true;
            DesktopLog.Write("Visible smoke: Shown.");
            timer.Start();
        };
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            DesktopLog.Write("Visible desktop window smoke test passed; disposing form.");
            window.Dispose();
            Application.ExitThread();
        };

        DesktopLog.Write("Visible smoke: entering Application.Run.");
        Application.Run(window);
        DesktopLog.Write($"Visible smoke: Application.Run returned; shown={shown}.");
        if (!shown)
            throw new InvalidOperationException("Phoenix desktop window never reached the Shown state.");
    }
}

internal sealed class PhoenixApplicationContext : ApplicationContext
{
    private readonly NotifyIcon tray;
    private readonly ToolStripMenuItem restartItem;
    private readonly ToolStripMenuItem autostartItem;
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(1.5) };
    private readonly PhoenixDesktopWindow window;
    private readonly EventWaitHandle showEvent;
    private readonly Thread showSignalThread;
    private Process? ownedRuntime;
    private bool externallyManaged;
    private bool shuttingDown;

    internal PhoenixApplicationContext(EventWaitHandle showEvent)
    {
        this.showEvent = showEvent;

        // The desktop window is created and shown immediately. Runtime bootstrap happens behind it,
        // so a first launch can never look like a dead EXE again.
        window = new PhoenixDesktopWindow(Program.PhoenixUri);
        _ = window.Handle;

        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir Phoenix", null, (_, _) => ShowWindow());
        restartItem = new ToolStripMenuItem("Reiniciar runtime administrado", null, async (_, _) => await RestartOwnedRuntimeAsync());
        menu.Items.Add(restartItem);
        menu.Items.Add(new ToolStripSeparator());
        autostartItem = new ToolStripMenuItem("Iniciar con Windows")
        {
            Checked = StartupRegistration.IsEnabled(),
            CheckOnClick = true,
        };
        autostartItem.CheckedChanged += (_, _) => StartupRegistration.SetEnabled(autostartItem.Checked);
        menu.Items.Add(autostartItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Salir", null, (_, _) => ExitPhoenix());

        tray = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application,
            Text = "Phoenix · preparando",
            Visible = true,
            ContextMenuStrip = menu,
        };
        tray.DoubleClick += (_, _) => ShowWindow();

        showSignalThread = new Thread(ListenForShowSignal)
        {
            IsBackground = true,
            Name = "PhoenixShowWindowSignal",
        };
        showSignalThread.Start();

        window.SetStartupStatus(DesktopStartupContract.InitialStatus);
        ShowWindow();
        DesktopLog.Write("Desktop window shown before runtime readiness.");
        _ = StartAsync();
    }

    private void ListenForShowSignal()
    {
        try
        {
            while (!shuttingDown)
            {
                showEvent.WaitOne();
                if (shuttingDown) break;
                ShowWindow();
            }
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Show-window signal listener failed", ex);
        }
    }

    private void ShowWindow()
    {
        if (window.IsDisposed || shuttingDown) return;
        if (window.InvokeRequired)
        {
            try { window.BeginInvoke((Action)ShowWindow); } catch { }
            return;
        }
        window.ShowAndActivate();
    }

    private async Task StartAsync()
    {
        try
        {
            // Never adopt an arbitrary listener on 3080. The bootstrap owns migration of any
            // previous PHOENIX host, synchronizes the managed checkout with stable, and only
            // then do we launch the supervised runtime. This prevents an old desktop process
            // from pinning the visible UI and permission policy to a stale checkout.
            window.SetStartupStatus("Sincronizando Phoenix estable…");
            if (!await EnsureManagedRuntimeAsync())
                return;

            await StartOwnedRuntimeAsync(openWhenReady: true);
        }
        catch (Exception ex)
        {
            DesktopLog.Write("StartAsync failed", ex);
            tray.Text = "Phoenix · error";
            window.SetStartupStatus($"No se pudo iniciar Phoenix.\n\n{ex.Message}\n\nDiagnóstico: {Program.LogPath}", isError: true);
            MessageBox.Show(
                $"Phoenix encontró un error durante el arranque.\n\n{ex.Message}\n\nDiagnóstico: {Program.LogPath}",
                "Phoenix · error de inicio",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private async Task<bool> EnsureManagedRuntimeAsync()
    {
        var state = ManagedRuntimeMarker.Inspect(Program.RuntimeRoot);
        DesktopLog.Write($"Managed runtime state: {state}");

        if (state == ManagedRuntimeState.Unmanaged)
        {
            window.SetStartupStatus("Phoenix encontró un runtime local no administrado.", isError: true);
            MessageBox.Show(
                $"Phoenix encontró un runtime no administrado en:\n{Program.RuntimeRoot}\n\nPor seguridad no lo modificará.\n\nDiagnóstico: {Program.LogPath}",
                "Phoenix", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }

        var script = Path.Combine(AppContext.BaseDirectory, "bootstrap-runtime.ps1");
        if (!File.Exists(script))
        {
            window.SetStartupStatus("Falta bootstrap-runtime.ps1. Reinstala Phoenix.", isError: true);
            MessageBox.Show("Falta bootstrap-runtime.ps1. Reinstala Phoenix desde el instalador oficial.",
                "Phoenix", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }

        window.SetStartupStatus(state switch
        {
            ManagedRuntimeState.Ready => "Buscando actualizaciones de Phoenix…",
            ManagedRuntimeState.Recoverable => "Reparando una instalación incompleta de Phoenix…",
            _ => "Preparando Phoenix por primera vez…",
        });
        tray.Text = state switch
        {
            ManagedRuntimeState.Ready => "Phoenix · actualizando",
            ManagedRuntimeState.Recoverable => "Phoenix · reparando",
            _ => "Phoenix · instalando",
        };

        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\" -RuntimeRoot \"{Program.RuntimeRoot}\"",
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = AppContext.BaseDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        DesktopLog.Write($"Starting managed runtime bootstrap: {psi.FileName} {psi.Arguments}");
        using var bootstrap = Process.Start(psi);
        if (bootstrap is null)
        {
            window.SetStartupStatus("No se pudo lanzar el preparador del runtime.", isError: true);
            return false;
        }

        var stdoutTask = bootstrap.StandardOutput.ReadToEndAsync();
        var stderrTask = bootstrap.StandardError.ReadToEndAsync();
        await bootstrap.WaitForExitAsync();
        var stdout = await stdoutTask;
        var stderr = await stderrTask;
        if (!string.IsNullOrWhiteSpace(stdout)) DesktopLog.Write("bootstrap stdout:\n" + stdout.Trim());
        if (!string.IsNullOrWhiteSpace(stderr)) DesktopLog.Write("bootstrap stderr:\n" + stderr.Trim());
        DesktopLog.Write($"Bootstrap exited with code {bootstrap.ExitCode}.");

        if (bootstrap.ExitCode == 0 && ManagedRuntimeMarker.Inspect(Program.RuntimeRoot) == ManagedRuntimeState.Ready)
            return true;

        window.SetStartupStatus($"No se pudo preparar Phoenix.\n\nRevisa: {Program.LogPath}", isError: true);
        MessageBox.Show(
            $"No se pudo preparar el runtime administrado de Phoenix. Comprueba Git, Node.js 22.19+ y Corepack.\n\nDiagnóstico: {Program.LogPath}",
            "Phoenix", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return false;
    }

    private async Task StartOwnedRuntimeAsync(bool openWhenReady)
    {
        if (ownedRuntime is { HasExited: false })
            return;

        window.SetStartupStatus("Iniciando Phoenix…");
        var supervisor = Path.Combine(Program.RuntimeRoot, "scripts", "phoenix-windows-supervisor.mjs");
        if (!File.Exists(supervisor))
        {
            window.SetStartupStatus("El runtime de Phoenix no contiene el supervisor de Windows.", isError: true);
            DesktopLog.Write($"Missing Windows supervisor: {supervisor}");
            return;
        }

        var psi = new ProcessStartInfo
        {
            FileName = "node.exe",
            Arguments = $"\"{supervisor}\" --no-open",
            WorkingDirectory = Program.RuntimeRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            Environment =
            {
                ["PHOENIX_DESKTOP_MANAGED"] = "1",
                ["PHOENIX_UPDATE_MODE"] = "auto",
                ["PHOENIX_AUTO_UPDATE"] = "1",
                ["PHOENIX_RUNTIME_ROOT"] = Program.RuntimeRoot,
            },
        };

        ownedRuntime = Process.Start(psi);
        if (ownedRuntime is null)
        {
            window.SetStartupStatus("Phoenix no pudo iniciar su runtime.", isError: true);
            MessageBox.Show("Phoenix no pudo iniciar el runtime administrado.", "Phoenix",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        ownedRuntime.OutputDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) DesktopLog.Write("runtime: " + e.Data); };
        ownedRuntime.ErrorDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) DesktopLog.Write("runtime stderr: " + e.Data); };
        ownedRuntime.BeginOutputReadLine();
        ownedRuntime.BeginErrorReadLine();

        externallyManaged = false;
        restartItem.Enabled = true;
        tray.Text = "Phoenix · iniciando";
        DesktopLog.Write($"Managed runtime process started with PID {ownedRuntime.Id}.");

        for (var attempt = 0; attempt < 120 && !shuttingDown; attempt++)
        {
            if (await IsReadyAsync())
            {
                tray.Text = "Phoenix · activo";
                window.MarkRuntimeReady();
                if (openWhenReady)
                    ShowWindow();
                DesktopLog.Write("Managed runtime is ready and desktop WebView is navigating to Phoenix.");
                return;
            }
            if (ownedRuntime.HasExited)
                break;
            await Task.Delay(1000);
        }

        if (!shuttingDown)
        {
            var exit = ownedRuntime.HasExited ? $" El proceso terminó con código {ownedRuntime.ExitCode}." : string.Empty;
            tray.Text = "Phoenix · error de inicio";
            window.SetStartupStatus($"Phoenix no alcanzó 127.0.0.1:3080.{exit}\n\nDiagnóstico: {Program.LogPath}", isError: true);
            MessageBox.Show(
                $"Phoenix no alcanzó http://127.0.0.1:3080.{exit}\n\nDiagnóstico: {Program.LogPath}",
                "Phoenix", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            DesktopLog.Write("Runtime did not become ready within the startup window." + exit);
        }
    }

    private async Task RestartOwnedRuntimeAsync()
    {
        if (externallyManaged)
            return;
        StopOwnedRuntime();
        window.SetStartupStatus("Reiniciando Phoenix…");
        await Task.Delay(700);
        await StartOwnedRuntimeAsync(openWhenReady: false);
    }

    private async Task<bool> IsReadyAsync()
    {
        try
        {
            using var response = await http.GetAsync(Program.PhoenixUri);
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private void StopOwnedRuntime()
    {
        if (ownedRuntime is null)
            return;
        try
        {
            if (!ownedRuntime.HasExited)
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "taskkill.exe",
                    Arguments = $"/PID {ownedRuntime.Id} /T /F",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                })?.WaitForExit(5000);
            }
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Failed to stop owned runtime process tree", ex);
        }
        finally
        {
            ownedRuntime.Dispose();
            ownedRuntime = null;
        }
    }

    private void ExitPhoenix()
    {
        shuttingDown = true;
        try { showEvent.Set(); } catch { }
        StopOwnedRuntime();
        if (!window.IsDisposed) window.Dispose();
        tray.Visible = false;
        tray.Dispose();
        http.Dispose();
        ExitThread();
    }
}

internal static class DesktopLog
{
    private static readonly object Gate = new();

    internal static void Write(string message, Exception? exception = null)
    {
        try
        {
            lock (Gate)
            {
                var directory = Path.GetDirectoryName(Program.LogPath)!;
                Directory.CreateDirectory(directory);
                var line = $"[{DateTimeOffset.Now:O}] {message}";
                if (exception is not null)
                    line += Environment.NewLine + exception;
                File.AppendAllText(Program.LogPath, line + Environment.NewLine);
            }
        }
        catch
        {
            // Diagnostics must never become a new startup failure.
        }
    }
}

internal static class StartupRegistration
{
    private const string KeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "Phoenix";

    internal static bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(KeyPath, writable: false);
        var registered = key?.GetValue(ValueName) as string;
        return string.Equals(registered?.Trim('"'), Application.ExecutablePath, StringComparison.OrdinalIgnoreCase);
    }

    internal static void SetEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(KeyPath);
        if (enabled)
            key.SetValue(ValueName, $"\"{Application.ExecutablePath}\"");
        else
            key.DeleteValue(ValueName, throwOnMissingValue: false);
    }
}
