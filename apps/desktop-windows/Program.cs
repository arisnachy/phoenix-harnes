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
    internal static readonly string LogRoot = Path.Combine(InstallRoot, "logs");
    internal static readonly string LogPath = Path.Combine(LogRoot, "desktop.log");

    [STAThread]
    private static void Main(string[] args)
    {
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

        DesktopLog.Write($"Phoenix desktop starting. Version={Application.ProductVersion} Base={AppContext.BaseDirectory}");

        using var mutex = new Mutex(initiallyOwned: true, "Local\\PhoenixDesktop.SingleInstance", out var ownsMutex);
        if (!ownsMutex)
        {
            DesktopLog.Write("Second Phoenix desktop launch detected; forwarding to existing local UI fallback.");
            DesktopBrowser.Open(PhoenixUri);
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => DesktopLog.Write("Unhandled UI exception", e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            DesktopLog.Write("Unhandled process exception", e.ExceptionObject as Exception);

        Application.Run(new PhoenixApplicationContext());
    }
}

internal sealed class PhoenixApplicationContext : ApplicationContext
{
    private readonly NotifyIcon tray;
    private readonly ToolStripMenuItem restartItem;
    private readonly ToolStripMenuItem autostartItem;
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(1.5) };
    private readonly PhoenixDesktopWindow window;
    private Process? ownedRuntime;
    private bool externallyManaged;
    private bool shuttingDown;

    internal PhoenixApplicationContext()
    {
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
        menu.Items.Add("Abrir registros", null, (_, _) => OpenLogs());
        menu.Items.Add("Salir", null, (_, _) => ExitPhoenix());

        tray = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application,
            Text = "Phoenix · iniciando",
            Visible = true,
            ContextMenuStrip = menu,
        };
        tray.DoubleClick += (_, _) => ShowWindow();

        // Always present a native Phoenix window before any network, Git, Node or runtime work.
        // First-run bootstrap can take time or fail; it must never look like a dead double-click.
        ShowWindow();
        window.SetStartupStatus("Comprobando runtime…");
        _ = StartAsync();
    }

    private void ShowWindow()
    {
        if (window.IsDisposed || shuttingDown) return;
        if (window.InvokeRequired)
        {
            window.BeginInvoke((Action)ShowWindow);
            return;
        }
        window.ShowAndActivate();
    }

    private void UpdateTray(string text, bool? restartEnabled = null)
    {
        if (window.IsDisposed || shuttingDown) return;
        if (window.InvokeRequired)
        {
            window.BeginInvoke((Action)(() => UpdateTray(text, restartEnabled)));
            return;
        }
        tray.Text = text.Length > 63 ? text[..63] : text;
        if (restartEnabled.HasValue)
            restartItem.Enabled = restartEnabled.Value;
    }

    private void ShowMessage(string message, MessageBoxIcon icon)
    {
        if (window.IsDisposed || shuttingDown) return;
        if (window.InvokeRequired)
        {
            window.BeginInvoke((Action)(() => ShowMessage(message, icon)));
            return;
        }
        MessageBox.Show(window, message, "Phoenix", MessageBoxButtons.OK, icon);
    }

    private async Task StartAsync()
    {
        try
        {
            DesktopLog.Write("Checking whether Phoenix runtime is already ready.");
            if (await IsReadyAsync())
            {
                externallyManaged = true;
                UpdateTray("Phoenix · runtime existente", restartEnabled: false);
                window.ShowPhoenixReady();
                return;
            }

            window.SetStartupStatus("Preparando runtime de Phoenix…");
            if (!await EnsureManagedRuntimeAsync())
            {
                UpdateTray("Phoenix · error de preparación", restartEnabled: false);
                window.SetStartupStatus($"No se pudo preparar Phoenix. Registro: {Program.LogPath}");
                return;
            }

            await StartOwnedRuntimeAsync(openWhenReady: true);
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Unexpected desktop startup failure", ex);
            UpdateTray("Phoenix · error de inicio", restartEnabled: false);
            window.SetStartupStatus($"Error al iniciar Phoenix. Registro: {Program.LogPath}");
            ShowMessage($"Phoenix encontró un error durante el inicio.\n\n{ex.Message}\n\nRegistro: {Program.LogPath}", MessageBoxIcon.Error);
        }
    }

    private async Task<bool> EnsureManagedRuntimeAsync()
    {
        var marker = Path.Combine(Program.RuntimeRoot, ".phoenix-managed-install");
        if (Directory.Exists(Program.RuntimeRoot) && File.Exists(marker) && IsManagedRuntimeReady(marker))
        {
            DesktopLog.Write("Managed runtime marker is ready.");
            return true;
        }

        if (Directory.Exists(Program.RuntimeRoot) && !File.Exists(marker))
        {
            DesktopLog.Write($"Refusing unmanaged runtime directory: {Program.RuntimeRoot}");
            ShowMessage(
                $"Phoenix encontró un runtime no administrado en:\n{Program.RuntimeRoot}\n\nPor seguridad no lo modificará.",
                MessageBoxIcon.Warning);
            return false;
        }

        if (Directory.Exists(Program.RuntimeRoot) && File.Exists(marker))
        {
            DesktopLog.Write("Managed runtime marker is incomplete; resuming bootstrap instead of treating it as ready.");
            window.SetStartupStatus("Reparando una instalación incompleta…");
        }
        else
        {
            window.SetStartupStatus("Instalando el runtime de Phoenix por primera vez…");
        }

        var script = Path.Combine(AppContext.BaseDirectory, "bootstrap-runtime.ps1");
        if (!File.Exists(script))
        {
            DesktopLog.Write($"Bootstrap script missing: {script}");
            ShowMessage(
                $"Falta bootstrap-runtime.ps1. Reinstala Phoenix desde el instalador oficial.\n\nRegistro: {Program.LogPath}",
                MessageBoxIcon.Error);
            return false;
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\" -RuntimeRoot \"{Program.RuntimeRoot}\"",
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = AppContext.BaseDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        DesktopLog.Write($"Starting managed runtime bootstrap: {startInfo.FileName} {startInfo.Arguments}");
        using var bootstrap = Process.Start(startInfo);
        if (bootstrap is null)
        {
            DesktopLog.Write("Process.Start returned null for bootstrap-runtime.ps1.");
            ShowMessage($"Phoenix no pudo iniciar el preparador del runtime.\n\nRegistro: {Program.LogPath}", MessageBoxIcon.Error);
            return false;
        }

        var stdoutTask = bootstrap.StandardOutput.ReadToEndAsync();
        var stderrTask = bootstrap.StandardError.ReadToEndAsync();
        await bootstrap.WaitForExitAsync();
        var stdout = await stdoutTask;
        var stderr = await stderrTask;

        if (!string.IsNullOrWhiteSpace(stdout))
            DesktopLog.Write("Bootstrap stdout:\n" + stdout.Trim());
        if (!string.IsNullOrWhiteSpace(stderr))
            DesktopLog.Write("Bootstrap stderr:\n" + stderr.Trim());

        if (bootstrap.ExitCode == 0 && File.Exists(marker) && IsManagedRuntimeReady(marker))
        {
            DesktopLog.Write("Managed runtime bootstrap completed successfully.");
            return true;
        }

        var detail = FirstUsefulLine(stderr) ?? FirstUsefulLine(stdout) ?? $"Exit code {bootstrap.ExitCode}";
        DesktopLog.Write($"Managed runtime bootstrap failed. ExitCode={bootstrap.ExitCode}; Detail={detail}");
        ShowMessage(
            $"No se pudo preparar el runtime administrado de Phoenix.\n\nDetalle: {detail}\n\nPhoenix necesita Git, Node.js 22.19+ y Corepack.\n\nRegistro: {Program.LogPath}",
            MessageBoxIcon.Error);
        return false;
    }

    private static bool IsManagedRuntimeReady(string marker)
    {
        try
        {
            var content = File.ReadAllText(marker);
            // Backward compatibility: older successful markers had installedAt but no explicit state.
            return content.Contains("state=ready", StringComparison.OrdinalIgnoreCase)
                || content.Contains("installedAt=", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static string? FirstUsefulLine(string text)
    {
        return text
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault(line => !string.IsNullOrWhiteSpace(line));
    }

    private async Task StartOwnedRuntimeAsync(bool openWhenReady)
    {
        if (ownedRuntime is { HasExited: false })
            return;

        window.SetStartupStatus("Iniciando Phoenix…");
        var startInfo = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/d /s /c \"corepack pnpm phoenix -- --no-open\"",
            WorkingDirectory = Program.RuntimeRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            Environment =
            {
                ["PHOENIX_DESKTOP_MANAGED"] = "1",
            },
        };

        DesktopLog.Write($"Starting Phoenix runtime in {Program.RuntimeRoot}.");
        ownedRuntime = Process.Start(startInfo);

        if (ownedRuntime is null)
        {
            DesktopLog.Write("Process.Start returned null for Phoenix runtime.");
            window.SetStartupStatus($"No se pudo iniciar Phoenix. Registro: {Program.LogPath}");
            ShowMessage($"Phoenix no pudo iniciar el runtime administrado.\n\nRegistro: {Program.LogPath}", MessageBoxIcon.Error);
            return;
        }

        ownedRuntime.OutputDataReceived += (_, e) =>
        {
            if (!string.IsNullOrWhiteSpace(e.Data)) DesktopLog.Write("[runtime] " + e.Data);
        };
        ownedRuntime.ErrorDataReceived += (_, e) =>
        {
            if (!string.IsNullOrWhiteSpace(e.Data)) DesktopLog.Write("[runtime:stderr] " + e.Data);
        };
        ownedRuntime.BeginOutputReadLine();
        ownedRuntime.BeginErrorReadLine();

        externallyManaged = false;
        UpdateTray("Phoenix · iniciando", restartEnabled: true);

        for (var attempt = 0; attempt < 90 && !shuttingDown; attempt++)
        {
            if (await IsReadyAsync())
            {
                DesktopLog.Write("Phoenix runtime reached http://127.0.0.1:3080.");
                UpdateTray("Phoenix · activo", restartEnabled: true);
                window.ShowPhoenixReady();
                if (openWhenReady)
                    ShowWindow();
                return;
            }
            if (ownedRuntime.HasExited)
            {
                DesktopLog.Write($"Phoenix runtime exited before readiness. ExitCode={ownedRuntime.ExitCode}");
                break;
            }
            await Task.Delay(1000);
        }

        if (!shuttingDown)
        {
            UpdateTray("Phoenix · error de inicio", restartEnabled: true);
            window.SetStartupStatus($"Phoenix no pudo iniciar. Registro: {Program.LogPath}");
            ShowMessage(
                $"Phoenix no alcanzó http://127.0.0.1:3080.\n\nEl runtime se dejó intacto para diagnóstico.\n\nRegistro: {Program.LogPath}",
                MessageBoxIcon.Warning);
        }
    }

    private async Task RestartOwnedRuntimeAsync()
    {
        if (externallyManaged)
            return;
        window.SetStartupStatus("Reiniciando Phoenix…");
        StopOwnedRuntime();
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

    private void OpenLogs()
    {
        try
        {
            Directory.CreateDirectory(Program.LogRoot);
            Process.Start(new ProcessStartInfo(Program.LogRoot) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Could not open log directory", ex);
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
        DesktopLog.Write("Phoenix desktop exiting.");
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
                Directory.CreateDirectory(Program.LogRoot);
                var line = $"[{DateTimeOffset.Now:O}] {message}";
                if (exception is not null)
                    line += Environment.NewLine + exception;
                File.AppendAllText(Program.LogPath, line + Environment.NewLine);
            }
        }
        catch
        {
            // Logging must never become a second startup failure.
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

/// <summary>Fallback used only when a second Phoenix process is started while the desktop owner already runs.</summary>
internal static class DesktopBrowser
{
    internal static void Open(Uri uri)
    {
        try
        {
            var edge = FindEdge();
            if (edge is not null)
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = edge,
                    Arguments = $"--app=\"{uri}\" --start-maximized",
                    UseShellExecute = false,
                });
                return;
            }

            Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Could not open duplicate-process fallback", ex);
        }
    }

    private static string? FindEdge()
    {
        string[] candidates =
        [
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
        ];
        return candidates.FirstOrDefault(File.Exists);
    }
}
