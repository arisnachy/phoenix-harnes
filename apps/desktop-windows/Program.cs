using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
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

        if (args.Contains("--prepare-runtime", StringComparer.OrdinalIgnoreCase))
        {
            DesktopLog.Write("Preparing bundled Phoenix runtime before interactive launch.");
            var prepared = DesktopRuntimeSeedInstaller.EnsureInstalled(
                ApplicationRoot,
                RuntimeRoot,
                message => DesktopLog.Write(message));
            if (!prepared)
                throw new InvalidOperationException("Phoenix could not pre-install its bundled runtime seed.");
            return;
        }

        if (args.Contains("--prepare-webview", StringComparer.OrdinalIgnoreCase))
        {
            PreparePhoenixWebViewProfile();
            return;
        }

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
        if (args.Contains("--smoke-webview-loopback", StringComparer.OrdinalIgnoreCase))
        {
            RunLoopbackWebViewSmokeTest();
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

    private static void PreparePhoenixWebViewProfile()
    {
        DesktopLog.Write("Pre-warming Phoenix WebView2 shell profile.");
        ApplicationConfiguration.Initialize();

        Exception? failure = null;
        var completed = false;
        using var host = new Form
        {
            ShowInTaskbar = false,
            FormBorderStyle = FormBorderStyle.None,
            StartPosition = FormStartPosition.Manual,
            Location = new Point(-32000, -32000),
            Size = new Size(16, 16),
            Text = "Phoenix WebView Prewarm",
        };
        using var webView = new WebView2 { Dock = DockStyle.Fill };
        host.Controls.Add(webView);

        host.Shown += async (_, _) =>
        {
            try
            {
                var shellProfile = DesktopPhoenixLoopback.ShellProfilePath(InstallRoot);
                Directory.CreateDirectory(shellProfile);
                var options = new CoreWebView2EnvironmentOptions
                {
                    AdditionalBrowserArguments = DesktopPhoenixLoopback.ShellBrowserArguments,
                };
                var environment = await CoreWebView2Environment.CreateAsync(null, shellProfile, options);
                await webView.EnsureCoreWebView2Async(environment);
                completed = webView.CoreWebView2 is not null;
                DesktopLog.Write($"Phoenix WebView2 profile pre-warm completed={completed}; profile={shellProfile}.");
            }
            catch (Exception ex)
            {
                failure = ex;
                DesktopLog.Write("Phoenix WebView2 profile pre-warm failed.", ex);
            }
            finally
            {
                host.Dispose();
                Application.ExitThread();
            }
        };

        Application.Run(host);

        if (failure is not null)
            throw new InvalidOperationException("Phoenix could not pre-warm its WebView2 shell profile.", failure);
        if (!completed)
            throw new InvalidOperationException("Phoenix WebView2 shell profile pre-warm did not complete.");
    }

    private static void RunLoopbackWebViewSmokeTest()
    {
        DesktopLog.Write("Loopback WebView smoke: starting local HTTP server.");
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        using var cancellation = new CancellationTokenSource();

        var serverTask = Task.Run(async () =>
        {
            var body = "<!doctype html><html><head><title>PHOENIX HARDNESS</title></head><body><div id=\"root\">loopback-smoke</div></body></html>";
            var bodyBytes = Encoding.UTF8.GetBytes(body);
            var headers = Encoding.ASCII.GetBytes(
                $"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {bodyBytes.Length}\r\nConnection: close\r\n\r\n");

            while (!cancellation.IsCancellationRequested)
            {
                TcpClient? client = null;
                try
                {
                    client = await listener.AcceptTcpClientAsync(cancellation.Token);
                    using (client)
                    using (var stream = client.GetStream())
                    {
                        var request = new byte[8192];
                        _ = await stream.ReadAsync(request, cancellation.Token);
                        await stream.WriteAsync(headers, cancellation.Token);
                        await stream.WriteAsync(bodyBytes, cancellation.Token);
                        await stream.FlushAsync(cancellation.Token);
                    }
                }
                catch (OperationCanceledException)
                {
                    client?.Dispose();
                    break;
                }
                catch (ObjectDisposedException)
                {
                    client?.Dispose();
                    break;
                }
            }
        });

        var loaded = false;
        try
        {
            ApplicationConfiguration.Initialize();
            using var window = new PhoenixDesktopWindow(new Uri($"http://127.0.0.1:{port}/"))
            {
                WindowState = FormWindowState.Normal,
                Size = new Size(1100, 760),
            };
            using var poll = new System.Windows.Forms.Timer { Interval = 100 };
            using var timeout = new System.Windows.Forms.Timer { Interval = 15000 };

            window.Shown += (_, _) =>
            {
                DesktopLog.Write($"Loopback WebView smoke: native window shown; port={port}.");
                window.MarkRuntimeReady();
                poll.Start();
                timeout.Start();
            };
            poll.Tick += (_, _) =>
            {
                if (window.IsStartupOverlayVisible)
                    return;

                loaded = true;
                poll.Stop();
                timeout.Stop();
                DesktopLog.Write("Loopback WebView smoke passed: WebView2 loaded the local Phoenix shell.");
                window.Dispose();
                Application.ExitThread();
            };
            timeout.Tick += (_, _) =>
            {
                poll.Stop();
                timeout.Stop();
                DesktopLog.Write("Loopback WebView smoke timed out before NavigationCompleted success.");
                window.Dispose();
                Application.ExitThread();
            };

            Application.Run(window);
        }
        finally
        {
            cancellation.Cancel();
            listener.Stop();
            try { serverTask.Wait(TimeSpan.FromSeconds(2)); } catch { }
        }

        if (!loaded)
            throw new InvalidOperationException("WebView2 could not load a healthy local Phoenix loopback page.");
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
    private int? runtimeOwnerPid;
    private Task? startupTask;
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
            Program.DesktopControlDescriptorPath,
            clientPid => ownedRuntime is { HasExited: false } supervisor
                ? DesktopRuntimeProcessIdentity.IsSameOrDescendantOf(clientPid, supervisor.Id)
                : runtimeOwnerPid is int ownerPid
                    && DesktopRuntimeProcessIdentity.IsSameOrDescendantOf(clientPid, ownerPid));
        DesktopLog.Write($"Desktop browser control pipe ready: {browserControl.PipeName}");

        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir Phoenix", null, (_, _) => ShowWindow(userEntry: true));
        restartItem = new ToolStripMenuItem("Reiniciar runtime administrado", null, async (_, _) => await RestartOwnedRuntimeAsync());
        menu.Items.Add(restartItem);

        developerConsoleItem = new ToolStripMenuItem("Mostrar consola de desarrollo")
        {
            Checked = developerConsoleVisible,
            CheckOnClick = true,
            ToolTipText = "Muestra la consola y los logs del runtime. Desactivado por defecto para usuarios normales.",
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
        tray.DoubleClick += (_, _) => ShowWindow(userEntry: true);

        showSignalThread = new Thread(ListenForShowSignal)
        {
            IsBackground = true,
            Name = "PhoenixShowWindowSignal",
        };
        showSignalThread.Start();

        window.SetStartupStatus(DesktopStartupContract.InitialStatus);
        ShowWindow(userEntry: true);
        DesktopLog.Write("Desktop window shown before runtime readiness.");
    }

    private void ListenForShowSignal()
    {
        try
        {
            while (!shuttingDown)
            {
                showEvent.WaitOne();
                if (shuttingDown) break;
                ShowWindow(userEntry: true);
            }
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Show-window signal listener failed", ex);
        }
    }

    private void ShowWindow(bool userEntry = false)
    {
        if (window.IsDisposed || shuttingDown) return;
        if (window.InvokeRequired)
        {
            try { window.BeginInvoke((Action)(() => ShowWindow(userEntry))); } catch { }
            return;
        }

        window.ShowAndActivate();
        if (userEntry)
        {
            window.PrepareForAppEntry();
            EnsureStartupAttempt();
        }
        else
        {
            window.RefreshPhoenixOnEntry();
        }
    }

    private void EnsureStartupAttempt()
    {
        if (shuttingDown || window.RuntimeReady)
            return;
        if (startupTask is { IsCompleted: false })
            return;

        DesktopLog.Write("Starting or retrying Phoenix desktop startup after app entry.");
        startupTask = StartAsync();
    }

    private async Task StartAsync()
    {
        try
        {
            window.SetStartupStatus("Iniciando Phoenix…");
            var stableListener = await IsStableReadyAsync();
            if (stableListener is not null)
            {
                var finalListener = await IsReadyAsync();
                if (finalListener is not null
                    && DesktopRuntimeLaunchContract.HasStableListenerIdentity(
                        stableListener.Value.ProcessId,
                        stableListener.Value.CreationTimeUtcTicks,
                        finalListener.Value.ProcessId,
                        finalListener.Value.CreationTimeUtcTicks))
                {
                    externallyManaged = true;
                    runtimeOwnerPid = finalListener.Value.ProcessId;
                    restartItem.Enabled = false;
                    restartItem.Text = "Phoenix ya está activo";
                    tray.Text = "Phoenix · activo";
                    window.MarkRuntimeReady();
                    ShowWindow();
                    DesktopLog.Write("Attached desktop shell to the already-running Phoenix on 127.0.0.1:3080.");
                    return;
                }

                DesktopLog.Write("Phoenix listener identity changed during the final readiness check; continuing with owned runtime startup.");
            }

            // Phoenix.exe is the desktop supervisor. If the user has a real Phoenix source
            // checkout, prefer it automatically so double-clicking the EXE performs the same startup
            // they currently have to do by hand in PowerShell. Verified/configured roots win first;
            // conventional ChatGPT/Phoenix locations are then probed. If no checkout is runnable,
            // fall back to the bundled managed runtime.
            var sourceRoot = DesktopSourceCheckout.Resolve(
                Program.InstallRoot,
                includeConventional: true);

            if (sourceRoot is not null)
            {
                runtimeRoot = sourceRoot;
                sourceCheckoutRuntime = true;
                restartItem.Text = "Reiniciar Phoenix";
                tray.Text = "Phoenix · iniciando checkout local";
                window.SetStartupStatus("Iniciando tu Phoenix local…");
                DesktopLog.Write($"Desktop EXE selected local Phoenix checkout for automatic PowerShell/pnpm startup: {runtimeRoot}");

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
            runtimeOwnerPid = null;
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
        var bundledSeed = DesktopRuntimeSeedInstaller.ArchivePath(AppContext.BaseDirectory);

        if (state == ManagedRuntimeState.Ready
            && (!File.Exists(bundledSeed)
                || DesktopRuntimeSeedInstaller.IsCurrent(AppContext.BaseDirectory, Program.RuntimeRoot)))
        {
            // A verified runtime should boot immediately. The Windows supervisor already owns
            // background stable updates after the Host is healthy, so doing a network/update
            // check here only makes every desktop launch slower and can strand the shell on a
            // blank startup screen when GitHub or the updater is slow. A bundled seed with a
            // different commit is refreshed before launch so an older ready marker cannot hide
            // missing production packages after a desktop upgrade.
            DesktopLog.Write("Managed runtime is ready and its bundled seed is current or unavailable; launching immediately and leaving stable updates to the supervised background watcher.");
            return true;
        }

        // New installers carry a production runtime that was already installed and built in CI.
        // Runtime-seed extraction can involve hundreds of MB and thousands of files, so it must
        // never execute on the WinForms thread. The installer normally pre-warms this path; this
        // worker-thread fallback keeps direct EXE launches responsive too.
        if (File.Exists(bundledSeed))
        {
            var updating = state == ManagedRuntimeState.Ready;
            window.SetStartupStatus(updating ? "Actualizando el runtime de Phoenix…" : "Preparando el runtime de Phoenix…");
            tray.Text = updating ? "Phoenix · actualizando" : "Phoenix · preparando";
            DesktopLog.Write($"Installing bundled runtime seed without blocking the UI: {bundledSeed}");
            var installed = await Task.Run(() => DesktopRuntimeSeedInstaller.EnsureInstalled(
                AppContext.BaseDirectory,
                Program.RuntimeRoot,
                message => DesktopLog.Write(message)));
            if (installed)
                return true;
        }

        // Compatibility fallback for older installers that predate runtime-seed.zip.
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

    private async Task<DesktopRuntimeListenerIdentity?> IsCompatiblePhoenixListenerAsync()
    {
        try
        {
            var firstListener = DesktopRuntimeProcessIdentity.FindListeningProcessIdentity(DesktopRuntimeLaunchContract.DesktopPort);
            if (firstListener is null || !DesktopRuntimeProcessIdentity.IsStillAlive(firstListener.Value))
            {
                DesktopLog.Write("Phoenix identity probe found no live loopback listener before the HTTP request.");
                return null;
            }

            // Identify Phoenix through its own HTML shell and then validate the owning process
            // after the HTTP request. The listener must not change while the response is read.
            using var response = await http.GetAsync(Program.PhoenixUri, HttpCompletionOption.ResponseContentRead);
            if (!response.IsSuccessStatusCode)
            {
                DesktopLog.Write($"Phoenix identity probe returned HTTP {(int)response.StatusCode}.");
                return null;
            }

            var html = await response.Content.ReadAsStringAsync();
            var compatible = DesktopPhoenixIdentity.LooksLikePhoenixHtml(html);
            if (!compatible)
            {
                DesktopLog.Write($"Phoenix identity probe compatible=false; bytes={html.Length}.");
                return null;
            }

            var listener = DesktopRuntimeProcessIdentity.FindListeningProcessIdentity(DesktopRuntimeLaunchContract.DesktopPort);
            if (listener is null)
            {
                DesktopLog.Write("Phoenix identity probe found the Phoenix shell but no owning listener PID after the HTTP request.");
                return null;
            }

            var stableIdentity = DesktopRuntimeLaunchContract.HasStableListenerIdentity(
                firstListener.Value.ProcessId,
                firstListener.Value.CreationTimeUtcTicks,
                listener.Value.ProcessId,
                listener.Value.CreationTimeUtcTicks);
            var processAlive = stableIdentity && DesktopRuntimeProcessIdentity.IsStillAlive(listener.Value);
            var supervisor = ownedRuntime;
            var processCompatible = false;
            if (supervisor is not null)
            {
                try
                {
                    processCompatible = !supervisor.HasExited
                        && DesktopRuntimeProcessIdentity.IsSameOrDescendantOf(listener.Value.ProcessId, supervisor.Id);
                }
                catch (InvalidOperationException)
                {
                    processCompatible = false;
                }
            }
            else
            {
                var commandLine = DesktopRuntimeProcessIdentity.TryGetCommandLine(listener.Value.ProcessId);
                processCompatible = DesktopRuntimeLaunchContract.CanAdoptListener(commandLine);
            }

            DesktopLog.Write($"Phoenix identity probe compatible={stableIdentity && processAlive && processCompatible}; listenerPid={listener.Value.ProcessId}; processAlive={processAlive}; processCompatible={processCompatible}; ownedRuntime={supervisor is not null}; bytes={html.Length}.");
            return stableIdentity && processAlive && processCompatible ? listener : null;
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Phoenix identity probe failed.", ex);
            return null;
        }
    }

    private async Task<bool> StartOwnedRuntimeAsync(bool openWhenReady, bool reportFailure = true)
    {
        if (ownedRuntime is { HasExited: false })
            return true;

        window.MarkRuntimeUnavailable();
        window.SetStartupStatus("Iniciando Phoenix…");
        var launcher = Path.Combine(runtimeRoot, "scripts", "phoenix-windows-supervisor.mjs");
        if (!File.Exists(launcher))
        {
            DesktopLog.Write($"Phoenix runtime supervisor is missing: {launcher}");
            if (reportFailure)
            {
                window.SetStartupStatus("Phoenix no encontró su supervisor de Windows.", isError: true);
                MessageBox.Show(
                    $"Falta el supervisor de runtime de Phoenix.\n\n{launcher}\n\nDiagnóstico: {Program.LogPath}",
                    "Phoenix · error de inicio",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            return false;
        }

        var psi = DesktopRuntimeLaunchContract.CreateOwnedRuntimeStartInfo(
            AppContext.BaseDirectory,
            runtimeRoot,
            browserControl.DescriptorPath,
            managedRuntime: !sourceCheckoutRuntime,
            showDeveloperConsole: developerConsoleVisible);
        DesktopLog.Write($"Launching Phoenix runtime directly from {runtimeRoot}: {psi.FileName} {string.Join(" ", psi.ArgumentList)}");

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
        runtimeOwnerPid = ownedRuntime.Id;

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
        DesktopRuntimeListenerIdentity? previousReady = null;

        while (wait.Elapsed < maxWait && !shuttingDown)
        {
            var currentReady = await IsReadyAsync();
            if (currentReady is not null)
            {
                consecutiveReady = previousReady is not null
                    && DesktopRuntimeLaunchContract.HasStableListenerIdentity(
                        previousReady.Value.ProcessId,
                        previousReady.Value.CreationTimeUtcTicks,
                        currentReady.Value.ProcessId,
                        currentReady.Value.CreationTimeUtcTicks)
                    ? consecutiveReady + 1
                    : 1;
                previousReady = currentReady;
                if (DesktopRuntimeLaunchContract.CanMarkReady(ownedRuntime.HasExited, consecutiveReady))
                {
                    var finalReady = await IsReadyAsync();
                    if (finalReady is null
                        || !DesktopRuntimeLaunchContract.HasStableListenerIdentity(
                            currentReady.Value.ProcessId,
                            currentReady.Value.CreationTimeUtcTicks,
                            finalReady.Value.ProcessId,
                            finalReady.Value.CreationTimeUtcTicks)
                        || !DesktopRuntimeLaunchContract.CanMarkReady(ownedRuntime.HasExited, consecutiveReady))
                    {
                        previousReady = finalReady;
                        consecutiveReady = finalReady is null ? 0 : 1;
                        continue;
                    }

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
                previousReady = null;
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
        window.MarkRuntimeUnavailable();
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
                window.MarkRuntimeUnavailable();
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


    private async Task<DesktopRuntimeListenerIdentity?> IsStableReadyAsync()
    {
        DesktopRuntimeListenerIdentity? first = null;
        for (var sample = 0; sample < DesktopRuntimeLaunchContract.ReadyConsecutiveSamples; sample++)
        {
            var current = await IsReadyAsync();
            if (current is null)
                return null;

            if (first is not null
                && !DesktopRuntimeLaunchContract.HasStableListenerIdentity(
                    first.Value.ProcessId,
                    first.Value.CreationTimeUtcTicks,
                    current.Value.ProcessId,
                    current.Value.CreationTimeUtcTicks))
                return null;

            first ??= current;

            if (sample + 1 < DesktopRuntimeLaunchContract.ReadyConsecutiveSamples)
                await Task.Delay(DesktopRuntimeLaunchContract.ReadySampleDelayMilliseconds);
        }
        return first;
    }

    private Task<DesktopRuntimeListenerIdentity?> IsReadyAsync()
    {
        // Readiness means the Phoenix application shell is actually being served, not just that
        // something answered on port 3080. This avoids racing WebView2 against a half-started host.
        return IsCompatiblePhoenixListenerAsync();
    }

    private void StopOwnedRuntime()
    {
        if (ownedRuntime is null)
            return;
        try
        {
            if (!ownedRuntime.HasExited)
                ownedRuntime.Kill(entireProcessTree: true);
            ownedRuntime.WaitForExit(5000);
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Failed to stop owned runtime process tree", ex);
        }
        finally
        {
            ownedRuntime.Dispose();
            ownedRuntime = null;
            runtimeOwnerPid = null;
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
        window.StopCredentialBroker();
        if (!window.IsDisposed) window.Dispose();
        tray.Visible = false;
        tray.Dispose();
        http.Dispose();
        ExitThread();
    }
}

internal static class DesktopRuntimeProcessIdentity
{
    private const int ErrorNoMoreFiles = 18;
    private const uint ErrorInsufficientBuffer = 122;
    private const uint SnapshotAllProcesses = 0x00000002;
    private const int AddressFamilyInterNetwork = 2;
    private const int TcpTableOwnerPidListener = 3;
    private const int TcpStateListen = 2;
    private static readonly nint InvalidHandleValue = new(-1);

    [StructLayout(LayoutKind.Sequential)]
    private struct MibTcpRowOwnerPid
    {
        internal uint State;
        internal uint LocalAddress;
        internal uint LocalPort;
        internal uint RemoteAddress;
        internal uint RemotePort;
        internal uint OwningPid;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry32
    {
        internal uint Size;
        internal uint Usage;
        internal uint ProcessId;
        internal nint DefaultHeapId;
        internal uint ModuleId;
        internal uint ThreadCount;
        internal uint ParentProcessId;
        internal int PriorityBase;
        internal uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        internal string? ExecutableFileName;
    }

    [DllImport("iphlpapi.dll", SetLastError = true)]
    private static extern uint GetExtendedTcpTable(
        nint tcpTable,
        ref int size,
        [MarshalAs(UnmanagedType.Bool)] bool order,
        int addressFamily,
        int tableClass,
        uint reserved);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern nint CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "Process32FirstW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32First(nint snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "Process32NextW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32Next(nint snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(nint handle);

    internal static bool IsSameOrDescendantOf(int processId, int ancestorProcessId)
    {
        if (!OperatingSystem.IsWindows() || processId <= 0 || ancestorProcessId <= 0)
            return false;

        var snapshot = CreateToolhelp32Snapshot(SnapshotAllProcesses, 0);
        if (snapshot == InvalidHandleValue)
            return false;

        try
        {
            var parents = new Dictionary<int, int>();
            var entry = new ProcessEntry32
            {
                Size = (uint)Marshal.SizeOf<ProcessEntry32>(),
                ExecutableFileName = string.Empty,
            };
            if (!Process32First(snapshot, ref entry))
                return false;

            do
            {
                if (entry.ProcessId > 0 && entry.ParentProcessId > 0)
                    parents[(int)entry.ProcessId] = (int)entry.ParentProcessId;
            }
            while (Process32Next(snapshot, ref entry));

            if (Marshal.GetLastWin32Error() != ErrorNoMoreFiles)
                return false;

            return IsSameOrDescendantOf(processId, ancestorProcessId, parents);
        }
        catch
        {
            return false;
        }
        finally
        {
            _ = CloseHandle(snapshot);
        }
    }

    internal static bool IsSameOrDescendantOf(
        int processId,
        int ancestorProcessId,
        IReadOnlyDictionary<int, int> parentProcessIds)
    {
        if (processId <= 0 || ancestorProcessId <= 0)
            return false;

        var visited = new HashSet<int>();
        var current = processId;
        while (current > 0 && visited.Add(current))
        {
            if (current == ancestorProcessId)
                return true;
            if (!parentProcessIds.TryGetValue(current, out var parentProcessId))
                return false;
            current = parentProcessId;
        }

        return false;
    }

    internal static int? FindListeningProcessId(int port)
    {
        if (!OperatingSystem.IsWindows())
            return null;

        var size = 0;
        var status = GetExtendedTcpTable(
            nint.Zero,
            ref size,
            order: false,
            AddressFamilyInterNetwork,
            TcpTableOwnerPidListener,
            reserved: 0);
        if (status != ErrorInsufficientBuffer || size <= 0)
            return null;

        var table = Marshal.AllocHGlobal(size);
        try
        {
            status = GetExtendedTcpTable(
                table,
                ref size,
                order: false,
                AddressFamilyInterNetwork,
                TcpTableOwnerPidListener,
                reserved: 0);
            if (status != 0)
                return null;

            var rowCount = Marshal.ReadInt32(table);
            var rowSize = Marshal.SizeOf<MibTcpRowOwnerPid>();
            for (var index = 0; index < rowCount; index++)
            {
                var row = Marshal.PtrToStructure<MibTcpRowOwnerPid>(
                    IntPtr.Add(table, sizeof(int) + index * rowSize));
                if (row.State == TcpStateListen
                    && MatchesLoopbackListener(row.LocalAddress, row.LocalPort, port)
                    && row.OwningPid > 0)
                    return checked((int)row.OwningPid);
            }
        }
        catch
        {
            return null;
        }
        finally
        {
            Marshal.FreeHGlobal(table);
        }

        return null;
    }

    internal static DesktopRuntimeListenerIdentity? FindListeningProcessIdentity(int port)
    {
        var processId = FindListeningProcessId(port);
        if (processId is null)
            return null;

        try
        {
            using var process = Process.GetProcessById(processId.Value);
            if (process.HasExited)
                return null;

            return new DesktopRuntimeListenerIdentity(
                process.Id,
                process.StartTime.ToUniversalTime().Ticks);
        }
        catch
        {
            return null;
        }
    }

    internal static bool IsStillAlive(DesktopRuntimeListenerIdentity identity)
    {
        try
        {
            using var process = Process.GetProcessById(identity.ProcessId);
            return !process.HasExited
                && process.StartTime.ToUniversalTime().Ticks == identity.CreationTimeUtcTicks;
        }
        catch
        {
            return false;
        }
    }

    internal static string? TryGetCommandLine(int processId)
    {
        if (!OperatingSystem.IsWindows())
            return null;

        object? locator = null;
        object? services = null;
        object? results = null;
        object? current = null;
        try
        {
            var locatorType = Type.GetTypeFromProgID("WbemScripting.SWbemLocator");
            if (locatorType is null)
                return null;

            locator = Activator.CreateInstance(locatorType);
            if (locator is null)
                return null;

            services = ((dynamic)locator).ConnectServer(".", "root\\cimv2");
            results = ((dynamic)services).ExecQuery(
                $"SELECT CommandLine FROM Win32_Process WHERE ProcessId = {processId}");
            if (results is not System.Collections.IEnumerable enumerable)
                return null;

            string? commandLine = null;
            foreach (var item in enumerable)
            {
                current = item;
                commandLine = (string?)((dynamic)item).CommandLine;
                break;
            }

            return commandLine;
        }
        catch
        {
            return null;
        }
        finally
        {
            ReleaseComObject(current);
            ReleaseComObject(results);
            ReleaseComObject(services);
            ReleaseComObject(locator);
        }
    }

    private static void ReleaseComObject(object? value)
    {
        if (value is not null && Marshal.IsComObject(value))
            Marshal.FinalReleaseComObject(value);
    }

    private static int NetworkPort(uint value) =>
        (int)(((value & 0xff) << 8) | ((value >> 8) & 0xff));

    internal static bool MatchesLoopbackListener(uint localAddress, uint localPort, int port) =>
        localAddress == BitConverter.ToUInt32(IPAddress.Loopback.GetAddressBytes())
        && NetworkPort(localPort) == port;
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
