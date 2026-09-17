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

        using var mutex = new Mutex(initiallyOwned: true, "Local\\PhoenixDesktop.SingleInstance", out var ownsMutex);
        if (!ownsMutex)
        {
            // The first process owns the managed runtime and embedded WebView shell. A second launch
            // stays side-effect free and only exposes the already-running local UI as a fallback.
            DesktopBrowser.Open(PhoenixUri);
            return;
        }

        ApplicationConfiguration.Initialize();
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
        // Construct the window on the WinForms UI thread and force a handle now. StartAsync may
        // continue on a pool thread, so the handle gives ShowWindow a reliable BeginInvoke target.
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
            Text = "Phoenix",
            Visible = true,
            ContextMenuStrip = menu,
        };
        tray.DoubleClick += (_, _) => ShowWindow();

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

    private async Task StartAsync()
    {
        if (await IsReadyAsync())
        {
            externallyManaged = true;
            restartItem.Enabled = false;
            tray.Text = "Phoenix · runtime existente";
            ShowWindow();
            return;
        }

        if (!await EnsureManagedRuntimeAsync())
            return;

        await StartOwnedRuntimeAsync(openWhenReady: true);
    }

    private async Task<bool> EnsureManagedRuntimeAsync()
    {
        var marker = Path.Combine(Program.RuntimeRoot, ".phoenix-managed-install");
        if (Directory.Exists(Program.RuntimeRoot) && File.Exists(marker))
            return true;

        if (Directory.Exists(Program.RuntimeRoot) && !File.Exists(marker))
        {
            MessageBox.Show(
                $"Phoenix encontró un runtime no administrado en:\n{Program.RuntimeRoot}\n\nPor seguridad no lo modificará.",
                "Phoenix", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }

        var script = Path.Combine(AppContext.BaseDirectory, "bootstrap-runtime.ps1");
        if (!File.Exists(script))
        {
            MessageBox.Show("Falta bootstrap-runtime.ps1. Reinstala Phoenix desde el instalador oficial.",
                "Phoenix", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }

        var bootstrap = Process.Start(new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\" -RuntimeRoot \"{Program.RuntimeRoot}\"",
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = AppContext.BaseDirectory,
        });
        if (bootstrap is null)
            return false;
        await bootstrap.WaitForExitAsync();
        if (bootstrap.ExitCode == 0 && File.Exists(marker))
            return true;

        MessageBox.Show(
            "No se pudo preparar el runtime administrado de Phoenix. Comprueba que Git, Node.js 22.19+ y Corepack estén disponibles.",
            "Phoenix", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return false;
    }

    private async Task StartOwnedRuntimeAsync(bool openWhenReady)
    {
        if (ownedRuntime is { HasExited: false })
            return;

        ownedRuntime = Process.Start(new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/d /s /c \"corepack pnpm phoenix -- --no-open\"",
            WorkingDirectory = Program.RuntimeRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            Environment =
            {
                ["PHOENIX_DESKTOP_MANAGED"] = "1",
            },
        });

        if (ownedRuntime is null)
        {
            MessageBox.Show("Phoenix no pudo iniciar el runtime administrado.", "Phoenix",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        externallyManaged = false;
        restartItem.Enabled = true;
        tray.Text = "Phoenix · iniciando";

        for (var attempt = 0; attempt < 90 && !shuttingDown; attempt++)
        {
            if (await IsReadyAsync())
            {
                tray.Text = "Phoenix · activo";
                if (openWhenReady)
                    ShowWindow();
                return;
            }
            if (ownedRuntime.HasExited)
                break;
            await Task.Delay(1000);
        }

        if (!shuttingDown)
        {
            tray.Text = "Phoenix · error de inicio";
            MessageBox.Show("Phoenix no alcanzó http://127.0.0.1:3080. El runtime se dejó intacto para diagnóstico.",
                "Phoenix", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private async Task RestartOwnedRuntimeAsync()
    {
        if (externallyManaged)
            return;
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
        catch
        {
            // Never discover or kill unrelated Phoenix/Node processes. We only
            // attempt to terminate the process tree whose handle we own.
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
        StopOwnedRuntime();
        if (!window.IsDisposed) window.Dispose();
        tray.Visible = false;
        tray.Dispose();
        http.Dispose();
        ExitThread();
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
        catch
        {
            // Opening the duplicate-process fallback is convenience only; the owner stays alive.
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
