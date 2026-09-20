using System.Diagnostics;
using System.Drawing;
using System.Net.Http;
using System.Text;
using Microsoft.Win32;

namespace Phoenix.Desktop;

internal static class Program
{
    internal static readonly Uri PhoenixUri = new($"http://127.0.0.1:{DesktopRuntimeLaunchContract.DesktopPort}/");
    internal static readonly string ApplicationRoot = Path.GetFullPath(AppContext.BaseDirectory);
    internal static readonly string InstallRoot = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Phoenix");
    internal static readonly string RuntimeRoot = Path.Combine(InstallRoot, "runtime");
    internal static readonly string LogPath = Path.Combine(InstallRoot, "logs", "desktop.log");
    internal static readonly string DesktopControlDescriptorPath = Path.Combine(InstallRoot, "desktop-control.json");

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
        DesktopInstallationState.RememberApplicationRoot(InstallRoot, ApplicationRoot);
        DesktopLog.Write($"Phoenix application root: {ApplicationRoot}");
        var bundledToolchainActive = DesktopBundledToolchain.Activate(AppContext.BaseDirectory);
        DesktopLog.Write($"Bundled runtime toolchain active={bundledToolchainActive}; root={DesktopBundledToolchain.ToolchainRoot(AppContext.BaseDirectory)}");

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

        var developerConsoleVisible = DesktopDeveloperConsole.Requested(InstallRoot, args);
        DesktopLog.Write($"Developer console requested={developerConsoleVisible}.");
        ApplicationConfiguration.Initialize();
        Application.Run(new PhoenixApplicationContext(showEvent, developerConsoleVisible));
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
            DesktopLog.Write($"Visible smoke: BrowserCollapsed={!window.IsBrowserPaneVisible}.");
            if (window.IsBrowserPaneVisible)
                throw new InvalidOperationException("Phoenix embedded browser must start collapsed so chat owns the full window.");
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
    private readonly ToolStripMenuItem developerConsoleItem;
    private readonly ToolStripMenuItem autostartItem;
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(1.5) };
    private readonly PhoenixDesktopWindow window;
    private readonly DesktopBrowserControlServer browserControl;
    private readonly EventWaitHandle showEvent;
    private readonly Thread showSignalThread;
    private Process? ownedRuntime;
    private string runtimeRoot = Program.RuntimeRoot;
    private bool sourceCheckoutRuntime;
    private bool externallyManaged;
    private bool developerConsoleVisible;
    private bool changingDeveloperConsole;
    private bool shuttingDown;
    private bool signingOut;
    private int observedUnexpectedBackendRestarts;

    internal PhoenixApplicationContext(EventWaitHandle showEvent, bool developerConsoleVisible)
    {
        this.showEvent = showEvent;
        this.developerConsoleVisible = developerConsoleVisible;

        // The desktop window is created and shown immediately. Runtime bootstrap happens behind it,
        // so a first launch can never look like a dead EXE again.
        window = new PhoenixDesktopWindow(Program.PhoenixUri);
        window.LogoutRequested += async (_, _) => await SignOutAndExitAsync();
        _ = window.Handle;
        browserControl = new DesktopBrowserControlServer(
            window.ExecuteBrowserCommandAsync,
            Program.DesktopControlDescriptorPath);
        DesktopLog.Write($"Desktop browser control pipe ready: {browserControl.PipeName}");

        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir Phoenix", null, (_, _) => ShowWindow());
        restartItem = new ToolStripMenuItem("Reiniciar runtime administrado", null, async (_, _) => await RestartOwnedRuntimeAsync());
        menu.Items.Add(restartItem);

        developerConsoleItem = new ToolStripMenuItem("Mostrar consola de desarrollo")
        {
            Checked = developerConsoleVisible,
            CheckOnClick = true,
            ToolTipText = "Muestra PowerShell y los logs del runtime. Desactivado por defecto para usuarios normales.",
        };
        developerConsoleItem.CheckedChanged += async (_, _) => await ChangeDeveloperConsoleAsync(developerConsoleItem.Checked);
        menu.Items.Add(developerConsoleItem);

        menu.Items.Add(new ToolStripSeparator());
        autostartItem = new ToolStripMenuItem("Iniciar con Windows")
        {
            Checked = StartupRegistration.IsEnabled(),
            CheckOnClick = true,
        };
        autostartItem.CheckedChanged += (_, _) => StartupRegistration.SetEnabled(autostartItem.Checked);
        menu.Items.Add(autostartItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Cerrar sesión y salir", null, async (_, _) => await SignOutAndExitAsync());
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
        window.RefreshPhoenixOnEntry();
    }

    private async Task StartAsync()
    {
        try
        {
            window.SetStartupStatus("Iniciando Phoenix…");
            if (await IsStableReadyAsync())
            {
                if (await IsCompatiblePhoenixListenerAsync())
                {
                    externallyManaged = true;
                    restartItem.Enabled = false;
                    restartItem.Text = "Phoenix ya está activo";
                    tray.Text = "Phoenix · activo";
                    window.MarkRuntimeReady();
                    ShowWindow();
                    DesktopLog.Write("Attached desktop shell to the already-running Phoenix on 127.0.0.1:3080.");
                    return;
                }

                tray.Text = "Phoenix · puerto 3080 ocupado";
                window.SetStartupStatus(
                    "El puerto normal de Phoenix (3080) está ocupado por otro programa.\n\nCierra ese proceso y vuelve a abrir Phoenix.",
                    isError: true);
                DesktopLog.Write("Refused to attach because 127.0.0.1:3080 answered but its listener did not look like Phoenix.");
                return;
            }

            // Installed Phoenix is a product runtime, not an implicit developer checkout.
            // Source mode is opt-in through the developer console or PHOENIX_SOURCE_ROOT.
            // This prevents a stale/dirty local repository from hijacking normal EXE startup.
            var allowSourceCheckout = DesktopSourceCheckout.ShouldUseSourceCheckout(developerConsoleVisible);
            var sourceRoot = allowSourceCheckout
                ? DesktopSourceCheckout.Resolve(Program.InstallRoot, includeConventional: developerConsoleVisible)
                : null;

            if (sourceRoot is not null)
            {
                runtimeRoot = sourceRoot;
                sourceCheckoutRuntime = true;
                restartItem.Text = "Reiniciar Phoenix";
                tray.Text = "Phoenix · iniciando checkout local";
                window.SetStartupStatus("Iniciando tu Phoenix local…");
                DesktopLog.Write($"Explicit developer/source mode selected local Phoenix checkout: {runtimeRoot}");

                // A development checkout is useful, but it must never brick the installed app.
                // If it crashes, times out, or fails its readiness handshake, silently fall back
                // to the isolated managed stable runtime owned by the desktop installation.
                if (await StartOwnedRuntimeAsync(openWhenReady: true, reportFailure: false))
                    return;

                StopOwnedRuntime();
                if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("PHOENIX_SOURCE_ROOT")))
                    DesktopSourceCheckout.ForgetVerified(Program.InstallRoot);

                DesktopLog.Write($"Local Phoenix checkout failed startup; falling back to managed stable runtime: {sourceRoot}");
                window.SetStartupStatus("Tu Phoenix local no pudo iniciar. Recuperando la versión estable…");
                tray.Text = "Phoenix · recuperando estable";
            }

            runtimeRoot = Program.RuntimeRoot;
            sourceCheckoutRuntime = false;
            restartItem.Text = "Reiniciar runtime administrado";

            if (!await EnsureManagedRuntimeAsync())
                return;

            await StartOwnedRuntimeAsync(openWhenReady: true, reportFailure: true);
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

        if (state == ManagedRuntimeState.Ready)
        {
            // A verified runtime should boot immediately. The Windows supervisor already owns
            // background stable updates after the Host is healthy, so doing a network/update
            // check here only makes every desktop launch slower and can strand the shell on a
            // blank startup screen when GitHub or the updater is slow.
            DesktopLog.Write("Managed runtime is ready; launching immediately and leaving stable updates to the supervised background watcher.");
            return true;
        }

        var script = Path.Combine(AppContext.BaseDirectory, "bootstrap-runtime.ps1");
        if (!File.Exists(script))
        {
            window.SetStartupStatus("Falta bootstrap-runtime.ps1. Reinstala Phoenix.", isError: true);
            MessageBox.Show("Falta bootstrap-runtime.ps1. Reinstala Phoenix desde el instalador oficial.",
                "Phoenix", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }

        if (ManagedRuntimeMarker.RequiresCleanBootstrap(state))
        {
            // Never resume a half-installed managed runtime. Interrupted pnpm/build state can
            // leave the bootstrap looking frozen for minutes or poison every later launch.
            // The managed runtime is disposable, so replace it atomically and start clean.
            window.SetStartupStatus("Limpiando una instalación incompleta de Phoenix…");
            tray.Text = "Phoenix · reparando";
            if (!ResetManagedRuntimeDirectoryForRepair($"managed runtime requires clean bootstrap: {state}"))
            {
                ShowRuntimePreparationFailure();
                return false;
            }
            state = ManagedRuntimeState.Missing;
        }

        for (var attempt = 1; attempt <= 2; attempt++)
        {
            window.SetStartupStatus(attempt > 1
                ? "Reintentando la preparación de Phoenix desde cero…"
                : "Preparando Phoenix por primera vez…");
            tray.Text = attempt > 1 ? "Phoenix · reintentando" : "Phoenix · instalando";

            var exitCode = await RunBootstrapAsync(script, attempt);
            if (exitCode == 0 && ManagedRuntimeMarker.Inspect(Program.RuntimeRoot) == ManagedRuntimeState.Ready)
                return true;

            if (attempt == 1)
            {
                DesktopLog.Write($"Bootstrap attempt {attempt} did not produce a ready runtime (exit={exitCode}); recreating the disposable managed runtime and retrying once.");
                if (!ResetManagedRuntimeDirectoryForRepair($"bootstrap attempt {attempt} failed with exit code {exitCode}"))
                    break;
                state = ManagedRuntimeState.Missing;
            }
        }

        ShowRuntimePreparationFailure();
        return false;
    }

    private async Task<int> RunBootstrapAsync(string script, int attempt)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{script}\" -RuntimeRoot \"{Program.RuntimeRoot}\"",
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = AppContext.BaseDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        psi.Environment["CI"] = "1";
        psi.Environment["NO_COLOR"] = "1";
        psi.Environment["COREPACK_ENABLE_DOWNLOAD_PROMPT"] = "0";

        DesktopLog.Write($"Starting managed runtime bootstrap attempt {attempt}: {psi.FileName} {psi.Arguments}");
        using var bootstrap = Process.Start(psi);
        if (bootstrap is null)
        {
            DesktopLog.Write($"Bootstrap attempt {attempt} could not start.");
            return -1;
        }

        bootstrap.OutputDataReceived += (_, e) =>
        {
            if (string.IsNullOrWhiteSpace(e.Data)) return;
            DesktopLog.Write($"bootstrap {attempt}: {e.Data}");
            ReportBootstrapProgress(e.Data);
        };
        bootstrap.ErrorDataReceived += (_, e) =>
        {
            if (string.IsNullOrWhiteSpace(e.Data)) return;
            DesktopLog.Write($"bootstrap {attempt} stderr: {e.Data}");
            ReportBootstrapProgress(e.Data);
        };
        bootstrap.BeginOutputReadLine();
        bootstrap.BeginErrorReadLine();

        using var timeout = new CancellationTokenSource(
            TimeSpan.FromMinutes(DesktopRuntimeLaunchContract.ManagedBootstrapTimeoutMinutes));
        try
        {
            await bootstrap.WaitForExitAsync(timeout.Token);
            // Flush asynchronous output callbacks before inspecting the final exit code.
            bootstrap.WaitForExit();
        }
        catch (OperationCanceledException)
        {
            DesktopLog.Write($"Bootstrap attempt {attempt} exceeded {DesktopRuntimeLaunchContract.ManagedBootstrapTimeoutMinutes} minutes; terminating its process tree.");
            window.SetStartupStatus("La preparación tardó demasiado. Phoenix la reiniciará desde cero…");
            tray.Text = "Phoenix · recuperando";
            try
            {
                if (!bootstrap.HasExited)
                    bootstrap.Kill(entireProcessTree: true);
            }
            catch (Exception ex)
            {
                DesktopLog.Write("Could not terminate timed-out bootstrap process tree", ex);
            }
            return -2;
        }

        DesktopLog.Write($"Bootstrap attempt {attempt} exited with code {bootstrap.ExitCode}.");
        return bootstrap.ExitCode;
    }


    private void ReportBootstrapProgress(string line)
    {
        if (line.Contains("[PHOENIX BOOTSTRAP] cloning", StringComparison.OrdinalIgnoreCase)
            || line.Contains("Cloning into", StringComparison.OrdinalIgnoreCase)
            || line.Contains("Receiving objects", StringComparison.OrdinalIgnoreCase))
        {
            window.SetStartupStatus("Descargando el runtime estable de Phoenix…");
            tray.Text = "Phoenix · descargando";
            return;
        }

        if (line.Contains("[PHOENIX BOOTSTRAP] syncing", StringComparison.OrdinalIgnoreCase)
            || line.Contains("Resolving deltas", StringComparison.OrdinalIgnoreCase))
        {
            window.SetStartupStatus("Verificando archivos de Phoenix…");
            tray.Text = "Phoenix · verificando";
            return;
        }

        if (line.Contains("[PHOENIX BOOTSTRAP] installing", StringComparison.OrdinalIgnoreCase)
            || line.Contains("Progress: resolved", StringComparison.OrdinalIgnoreCase)
            || line.Contains("Lockfile is up to date", StringComparison.OrdinalIgnoreCase))
        {
            window.SetStartupStatus("Instalando componentes de Phoenix…");
            tray.Text = "Phoenix · instalando";
            return;
        }

        if (line.Contains("[PHOENIX BOOTSTRAP] building", StringComparison.OrdinalIgnoreCase)
            || line.Contains("Building PHOENIX", StringComparison.OrdinalIgnoreCase))
        {
            window.SetStartupStatus("Construyendo Phoenix…");
            tray.Text = "Phoenix · construyendo";
            return;
        }

        if (line.Contains("[PHOENIX BOOTSTRAP] ready", StringComparison.OrdinalIgnoreCase)
            || line.Contains("Phoenix managed runtime ready", StringComparison.OrdinalIgnoreCase))
        {
            window.SetStartupStatus("Phoenix está listo. Iniciando…");
            tray.Text = "Phoenix · iniciando";
        }
    }

    private bool ResetManagedRuntimeDirectoryForRepair(string reason)
    {
        try
        {
            var runtime = Path.GetFullPath(Program.RuntimeRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var expected = Path.GetFullPath(Path.Combine(Program.InstallRoot, "runtime"))
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (!string.Equals(runtime, expected, StringComparison.OrdinalIgnoreCase))
            {
                DesktopLog.Write($"Refused managed-runtime repair outside the desktop-owned path: {runtime}");
                return false;
            }

            if (!Directory.Exists(runtime))
                return true;

            var quarantine = $"{runtime}.broken-{DateTimeOffset.UtcNow:yyyyMMddHHmmssfff}";
            DesktopLog.Write($"Self-healing managed runtime ({reason}); moving {runtime} to {quarantine}.");
            Directory.Move(runtime, quarantine);

            _ = Task.Run(() =>
            {
                try
                {
                    Directory.Delete(quarantine, recursive: true);
                    DesktopLog.Write($"Removed quarantined runtime after successful detach: {quarantine}");
                }
                catch (Exception ex)
                {
                    DesktopLog.Write($"Could not remove quarantined runtime immediately: {quarantine}", ex);
                }
            });
            return true;
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Managed runtime self-heal failed", ex);
            return false;
        }
    }

    private void ShowRuntimePreparationFailure()
    {
        window.SetStartupStatus(
            $"Phoenix intentó reparar su runtime automáticamente, pero no pudo terminar la preparación.\n\nRevisa: {Program.LogPath}",
            isError: true);
        tray.Text = "Phoenix · reparación bloqueada";
        MessageBox.Show(
            $"Phoenix intentó reparar y reconstruir automáticamente su runtime, pero la preparación siguió fallando.\n\nDiagnóstico: {Program.LogPath}",
            "Phoenix", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    private async Task<bool> RefreshManagedRuntimeAsync()
    {
        var updater = Path.Combine(Program.RuntimeRoot, "update-phoenix.ps1");
        if (!File.Exists(updater))
        {
            DesktopLog.Write("Managed runtime has no update-phoenix.ps1; continuing with its current verified build.");
            return true;
        }

        window.SetStartupStatus("Comprobando la versión estable más reciente…");
        tray.Text = "Phoenix · actualizando";
        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = Program.RuntimeRoot,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.ArgumentList.Add("-NoLogo");
        psi.ArgumentList.Add("-NoProfile");
        psi.ArgumentList.Add("-NonInteractive");
        psi.ArgumentList.Add("-ExecutionPolicy");
        psi.ArgumentList.Add("Bypass");
        psi.ArgumentList.Add("-File");
        psi.ArgumentList.Add(updater);

        DesktopLog.Write("Checking promoted stable before desktop runtime launch.");
        using var updateProcess = Process.Start(psi);
        if (updateProcess is null)
        {
            DesktopLog.Write("Could not start managed stable updater; keeping the current verified runtime.");
            return true;
        }

        var stdoutTask = updateProcess.StandardOutput.ReadToEndAsync();
        var stderrTask = updateProcess.StandardError.ReadToEndAsync();
        await updateProcess.WaitForExitAsync();
        var stdout = await stdoutTask;
        var stderr = await stderrTask;
        if (!string.IsNullOrWhiteSpace(stdout)) DesktopLog.Write("stable update stdout:\n" + stdout.Trim());
        if (!string.IsNullOrWhiteSpace(stderr)) DesktopLog.Write("stable update stderr:\n" + stderr.Trim());

        if (updateProcess.ExitCode == 12)
        {
            window.SetStartupStatus(
                $"La actualización estable falló y no pudo recuperar el runtime.\n\nDiagnóstico: {Program.LogPath}",
                isError: true);
            tray.Text = "Phoenix · actualización bloqueada";
            return false;
        }

        if (updateProcess.ExitCode == 13)
        {
            window.SetStartupStatus(
                $"Phoenix detectó un runtime desactualizado y no pudo activar la versión estable nueva. La versión vieja no se iniciará.\n\nDiagnóstico: {Program.LogPath}",
                isError: true);
            tray.Text = "Phoenix · runtime desactualizado";
            DesktopLog.Write("Stable updater refused startup because the installed runtime is known stale.");
            return false;
        }

        if (updateProcess.ExitCode != 0)
            DesktopLog.Write($"Stable update check returned {updateProcess.ExitCode}; starting the last verified runtime because no newer stable target was confirmed.");

        return true;
    }

    private async Task<bool> IsCompatiblePhoenixListenerAsync()
    {
        const string script = """
            $ErrorActionPreference = 'SilentlyContinue'
            $owners = @(Get-NetTCPConnection -State Listen -LocalPort 3080 -ErrorAction SilentlyContinue |
              Select-Object -ExpandProperty OwningProcess -Unique)
            foreach ($ownerId in $owners) {
              $current = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId" -ErrorAction SilentlyContinue
              for ($depth = 0; $depth -lt 6 -and $current; $depth++) {
                $command = [string]$current.CommandLine
                if ($command) { Write-Output $command }
                $parentId = [int]$current.ParentProcessId
                if ($parentId -le 0) { break }
                $current = Get-CimInstance Win32_Process -Filter "ProcessId=$parentId" -ErrorAction SilentlyContinue
              }
            }
            """;

        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.ArgumentList.Add("-NoLogo");
        psi.ArgumentList.Add("-NoProfile");
        psi.ArgumentList.Add("-NonInteractive");
        psi.ArgumentList.Add("-EncodedCommand");
        psi.ArgumentList.Add(encoded);

        using var probe = Process.Start(psi);
        if (probe is null) return false;
        var stdoutTask = probe.StandardOutput.ReadToEndAsync();
        var stderrTask = probe.StandardError.ReadToEndAsync();
        await probe.WaitForExitAsync();
        var stdout = await stdoutTask;
        var stderr = await stderrTask;
        if (!string.IsNullOrWhiteSpace(stderr))
            DesktopLog.Write("Phoenix listener probe stderr: " + stderr.Trim());

        var lines = stdout.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
        var compatible = lines.Any(DesktopRuntimeLaunchContract.LooksLikePhoenixProcessCommandLine);
        DesktopLog.Write($"Phoenix listener probe compatible={compatible}; candidates={lines.Length}.");
        return probe.ExitCode == 0 && compatible;
    }

    private async Task<bool> StartOwnedRuntimeAsync(bool openWhenReady, bool reportFailure = true)
    {
        if (ownedRuntime is { HasExited: false })
            return true;

        window.SetStartupStatus("Iniciando Phoenix…");
        var launcher = Path.Combine(runtimeRoot, "phoenix-windows.cmd");
        if (!File.Exists(launcher))
        {
            DesktopLog.Write($"Phoenix runtime launcher is missing: {launcher}");
            if (reportFailure)
            {
                window.SetStartupStatus("Phoenix no encontró su supervisor de Windows.", isError: true);
                MessageBox.Show(
                    $"Falta el supervisor de Windows de Phoenix.\n\n{launcher}\n\nDiagnóstico: {Program.LogPath}",
                    "Phoenix · error de inicio",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            return false;
        }

        var psi = DesktopRuntimeLaunchContract.CreateOwnedRuntimeStartInfo(
            runtimeRoot,
            browserControl.DescriptorPath,
            managedRuntime: !sourceCheckoutRuntime,
            showDeveloperConsole: developerConsoleVisible);
        DesktopLog.Write($"Launching Phoenix runtime from {runtimeRoot} through PowerShell supervisor: {psi.FileName} {string.Join(" ", psi.ArgumentList)}");

        Interlocked.Exchange(ref observedUnexpectedBackendRestarts, 0);
        ownedRuntime = Process.Start(psi);
        if (ownedRuntime is null)
        {
            DesktopLog.Write($"Phoenix could not start runtime from {runtimeRoot}.");
            if (reportFailure)
            {
                window.SetStartupStatus("Phoenix no pudo iniciar su runtime.", isError: true);
                MessageBox.Show("Phoenix no pudo iniciar el runtime.", "Phoenix",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            return false;
        }

        if (psi.RedirectStandardOutput)
        {
            ownedRuntime.OutputDataReceived += (_, e) =>
            {
                if (string.IsNullOrWhiteSpace(e.Data)) return;
                DesktopLog.Write("runtime: " + e.Data);
                ReportRuntimeProgress(e.Data);
            };
            ownedRuntime.BeginOutputReadLine();
        }
        if (psi.RedirectStandardError)
        {
            ownedRuntime.ErrorDataReceived += (_, e) =>
            {
                if (string.IsNullOrWhiteSpace(e.Data)) return;
                DesktopLog.Write("runtime stderr: " + e.Data);
                ReportRuntimeProgress(e.Data);
            };
            ownedRuntime.BeginErrorReadLine();
        }

        externallyManaged = false;
        restartItem.Enabled = true;
        tray.Text = "Phoenix · iniciando";
        DesktopLog.Write($"Phoenix runtime process started with PID {ownedRuntime.Id} from {runtimeRoot}.");

        var maxWait = TimeSpan.FromSeconds(sourceCheckoutRuntime
            ? DesktopRuntimeLaunchContract.SourceStartupWaitSeconds
            : DesktopRuntimeLaunchContract.ManagedStartupWaitSeconds);
        var wait = Stopwatch.StartNew();
        var consecutiveReady = 0;

        while (wait.Elapsed < maxWait && !shuttingDown)
        {
            if (await IsReadyAsync())
            {
                consecutiveReady++;
                if (consecutiveReady >= DesktopRuntimeLaunchContract.ReadyConsecutiveSamples)
                {
                    if (sourceCheckoutRuntime)
                    {
                        DesktopSourceCheckout.RememberVerified(Program.InstallRoot, runtimeRoot);
                        DesktopLog.Write($"Verified backend root persisted: {runtimeRoot}");
                    }

                    tray.Text = "Phoenix · activo";
                    window.MarkRuntimeReady();
                    if (openWhenReady)
                        ShowWindow();
                    DesktopLog.Write($"Phoenix runtime is stable and ready from {runtimeRoot}; desktop WebView is navigating to Phoenix.");
                    return true;
                }
            }
            else
            {
                consecutiveReady = 0;
            }

            if (Volatile.Read(ref observedUnexpectedBackendRestarts) >= DesktopRuntimeLaunchContract.MaxUnexpectedBackendRestarts)
            {
                DesktopLog.Write($"Detected backend crash loop after {Volatile.Read(ref observedUnexpectedBackendRestarts)} unexpected restarts; stopping the desktop wait early.");
                break;
            }

            if (ownedRuntime.HasExited)
                break;

            await Task.Delay(DesktopRuntimeLaunchContract.ReadySampleDelayMilliseconds);
        }

        if (!shuttingDown)
        {
            var crashLoopDetected = Volatile.Read(ref observedUnexpectedBackendRestarts) >= DesktopRuntimeLaunchContract.MaxUnexpectedBackendRestarts;
            var exit = ownedRuntime.HasExited ? $" El proceso terminó con código {ownedRuntime.ExitCode}." : string.Empty;
            DesktopLog.Write(crashLoopDetected
                ? $"Runtime from {runtimeRoot} entered a backend crash loop."
                : $"Runtime from {runtimeRoot} did not become ready within the startup window." + exit);

            if (reportFailure)
            {
                tray.Text = "Phoenix · error de inicio";
                var subject = sourceCheckoutRuntime ? "Tu Phoenix local" : "Phoenix";
                var detail = crashLoopDetected
                    ? $"{subject} se reinició varias veces seguidas y Phoenix detuvo la espera para no dejarte atrapado en una pantalla de carga."
                    : ownedRuntime.HasExited
                        ? $"{subject} no pudo completar el arranque.{exit}"
                        : $"{subject} sigue sin responder en 127.0.0.1:3080 después del tiempo de preparación.";
                window.SetStartupStatus($"{detail}\n\nRevisa: {Program.LogPath}", isError: true);
                MessageBox.Show(
                    $"{detail}\n\nDiagnóstico: {Program.LogPath}",
                    "Phoenix", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }

            if (crashLoopDetected)
                StopOwnedRuntime();
        }
        return false;
    }

    private void ReportRuntimeProgress(string line)
    {
        if (line.Contains("Preparing PHOENIX dependencies", StringComparison.OrdinalIgnoreCase))
        {
            window.SetStartupStatus("Preparando dependencias…");
            tray.Text = "Phoenix · preparando";
            return;
        }

        if (line.Contains("Building PHOENIX for the first run", StringComparison.OrdinalIgnoreCase))
        {
            window.SetStartupStatus("Construyendo Phoenix por primera vez…");
            tray.Text = "Phoenix · construyendo";
            return;
        }

        if (line.Contains("PHOENIX RECOVERY", StringComparison.OrdinalIgnoreCase)
            || line.Contains("configuration preflight", StringComparison.OrdinalIgnoreCase))
        {
            window.SetStartupStatus("Verificando Phoenix…");
            tray.Text = "Phoenix · verificando";
            return;
        }

        if (line.Contains("host exited unexpectedly", StringComparison.OrdinalIgnoreCase))
            Interlocked.Increment(ref observedUnexpectedBackendRestarts);

        if (line.Contains("host exited unexpectedly", StringComparison.OrdinalIgnoreCase)
            || line.Contains("relaunch", StringComparison.OrdinalIgnoreCase)
            || line.Contains("restarting", StringComparison.OrdinalIgnoreCase))
        {
            window.SetStartupStatus("Reiniciando backend de Phoenix…");
            tray.Text = "Phoenix · reiniciando";
            return;
        }

        if (line.Contains("127.0.0.1:3080", StringComparison.OrdinalIgnoreCase)
            || line.Contains("listening", StringComparison.OrdinalIgnoreCase)
            || (line.Contains("server", StringComparison.OrdinalIgnoreCase)
                && line.Contains("ready", StringComparison.OrdinalIgnoreCase)))
        {
            window.SetStartupStatus("Backend listo. Cargando interfaz…");
            tray.Text = "Phoenix · cargando interfaz";
        }
    }

    private async Task RestartOwnedRuntimeAsync()
    {
        if (externallyManaged)
            return;
        StopOwnedRuntime();
        window.SetStartupStatus("Reiniciando Phoenix…");
        await Task.Delay(700);
        await StartOwnedRuntimeAsync(openWhenReady: false, reportFailure: true);
    }
    private async Task ChangeDeveloperConsoleAsync(bool enabled)
    {
        if (changingDeveloperConsole || shuttingDown)
            return;

        changingDeveloperConsole = true;
        try
        {
            developerConsoleVisible = enabled;
            DesktopDeveloperConsole.SetEnabled(Program.InstallRoot, enabled);
            DesktopLog.Write($"Developer console preference changed: visible={enabled}.");

            if (externallyManaged)
            {
                tray.ShowBalloonTip(
                    2500,
                    "Phoenix",
                    enabled
                        ? "La consola de desarrollo se mostrará la próxima vez que Phoenix inicie su propio runtime."
                        : "La consola de desarrollo quedó desactivada para el próximo arranque.",
                    ToolTipIcon.Info);
                return;
            }

            if (ownedRuntime is { HasExited: false })
            {
                window.SetStartupStatus(enabled
                    ? "Reiniciando Phoenix con consola de desarrollo…"
                    : "Reiniciando Phoenix en segundo plano…");
                StopOwnedRuntime();
                await Task.Delay(500);
                await StartOwnedRuntimeAsync(openWhenReady: false, reportFailure: true);
            }
        }
        finally
        {
            changingDeveloperConsole = false;
        }
    }


    private async Task<bool> IsStableReadyAsync()
    {
        for (var sample = 0; sample < DesktopRuntimeLaunchContract.ReadyConsecutiveSamples; sample++)
        {
            if (!await IsReadyAsync())
                return false;

            if (sample + 1 < DesktopRuntimeLaunchContract.ReadyConsecutiveSamples)
                await Task.Delay(DesktopRuntimeLaunchContract.ReadySampleDelayMilliseconds);
        }
        return true;
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

    private async Task SignOutAndExitAsync()
    {
        if (shuttingDown || signingOut) return;
        signingOut = true;
        try
        {
            tray.Text = "Phoenix · cerrando sesión";
            await window.ClearSessionAsync();
            DesktopLog.Write("Desktop session storage cleared by explicit user logout.");
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Desktop logout could not clear every WebView session item; exiting anyway.", ex);
        }
        finally
        {
            ExitPhoenix();
        }
    }

    private void ExitPhoenix()
    {
        shuttingDown = true;
        try { showEvent.Set(); } catch { }
        StopOwnedRuntime();
        browserControl.Dispose();
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
