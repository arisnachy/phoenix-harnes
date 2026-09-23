using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Phoenix.Desktop;

/// <summary>
/// Native Phoenix desktop shell. The left WebView hosts Phoenix itself; the right WebView is a
/// real Edge/Chromium browser surface that stays inside the same application window.
/// </summary>
internal sealed class PhoenixDesktopWindow : Form
{
    private static readonly TimeSpan CredentialPromptTimeout = TimeSpan.FromMinutes(2);
    private readonly Uri phoenixUri;
    private readonly SplitContainer split = new();
    private readonly WebView2 phoenixView = new();
    private readonly WebView2 browserView = new();
    private readonly ToolStripTextBox address = new();
    private readonly ToolStripButton backButton = new("←");
    private readonly ToolStripButton forwardButton = new("→");
    private readonly Panel startupOverlay = new();
    private readonly Label startupStatus = new();
    private readonly Label startupSpinner = new();
    private readonly System.Windows.Forms.Timer startupAnimationTimer = new() { Interval = 120 };
    private readonly Dictionary<string, PendingCredentialPrompt> pendingCredentialPrompts = new(StringComparer.Ordinal);
    private readonly object credentialBrokerGate = new();
    private readonly CancellationTokenSource credentialBrokerLifetime = new();
    private Task<DesktopCredentialBrokerProcess>? credentialBrokerTask;
    private int startupAnimationFrame;
    private bool initialized;
    private bool runtimeReady;
    private bool applyingBrowserLayout;
    private int? browserWidthOverride;
    private Task? browserInitializationTask;
    private TaskCompletionSource<bool>? pendingBrowserNavigation;
    private DateTimeOffset lastPhoenixNavigationAt = DateTimeOffset.MinValue;
    private int phoenixNavigationRetryCount;
    private bool phoenixNavigationRetryScheduled;
    private bool phoenixNavigationInFlight;

    private sealed class PendingCredentialPrompt(
        string requestId,
        string origin,
        string browserPageUri,
        TaskCompletionSource<DesktopCredentialPromptReply> completion)
    {
        internal string RequestId { get; } = requestId;
        internal string Origin { get; } = origin;
        internal string BrowserPageUri { get; } = browserPageUri;
        internal TaskCompletionSource<DesktopCredentialPromptReply> Completion { get; } = completion;
    }

    // Exposed to the native smoke test so CI verifies the real SplitContainer state,
    // not only the pure layout contract.
    internal bool IsBrowserPaneVisible => !split.Panel2Collapsed;
    internal bool RuntimeReady => runtimeReady;
    internal bool IsStartupOverlayVisible => startupOverlay.Visible;

    internal event EventHandler? LogoutRequested;

    private Task<DesktopCredentialBrokerProcess> GetCredentialBrokerAsync()
    {
        lock (credentialBrokerGate)
        {
            if (credentialBrokerTask is null || credentialBrokerTask.IsFaulted || credentialBrokerTask.IsCanceled)
            {
                var executable = Path.Combine(AppContext.BaseDirectory, "credential-broker", "Phoenix.CredentialBroker.exe");
                credentialBrokerTask = DesktopCredentialBrokerProcess.StartAsync(
                    executable,
                    "PhoenixCredentialVault",
                    credentialBrokerLifetime.Token);
            }
            return credentialBrokerTask;
        }
    }

    /// <summary>Stop the lazily started credential broker when Phoenix exits.</summary>
    internal void StopCredentialBroker()
    {
        credentialBrokerLifetime.Cancel();
        Task<DesktopCredentialBrokerProcess>? starting;
        lock (credentialBrokerGate)
            starting = credentialBrokerTask;

        if (starting is not null)
        {
            try
            {
                starting.GetAwaiter().GetResult().DisposeAsync().AsTask().GetAwaiter().GetResult();
            }
            catch (Exception)
            {
                DesktopLog.Write("Credential broker shutdown did not complete cleanly.");
            }
        }
        credentialBrokerLifetime.Dispose();
    }

    internal PhoenixDesktopWindow(Uri phoenixUri, bool initializeWebViewsOnShow = true)
    {
        this.phoenixUri = phoenixUri;
        Text = "Phoenix";
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1440, 900);
        MinimumSize = new Size(980, 640);
        WindowState = FormWindowState.Maximized;
        KeyPreview = true;

        split.Dock = DockStyle.Fill;
        split.Orientation = Orientation.Vertical;
        split.SplitterWidth = 6;
        // Collapse immediately, before the first paint. Waiting for Shown caused a visible
        // half-chat/half-browser flash on startup and made Phoenix look as if the browser owned
        // half the application even when no page had been requested.
        split.Panel2Collapsed = BrowserLayout.StartCollapsed;

        phoenixView.Dock = DockStyle.Fill;
        browserView.Dock = DockStyle.Fill;
        split.Panel1.Controls.Add(phoenixView);

        BuildStartupOverlay();
        split.Panel1.Controls.Add(startupOverlay);
        startupOverlay.BringToFront();

        var browserToolbar = BuildBrowserToolbar();
        split.Panel2.Controls.Add(browserView);
        split.Panel2.Controls.Add(browserToolbar);
        Controls.Add(split);

        // SplitContainer validates min sizes against its current Width. During construction the
        // control has not been laid out yet, so apply geometry only after WinForms has a real size.
        // The chat owns the full window at startup; the compact browser appears only when invoked.
        Shown += (_, _) => ApplyInitialSplitLayout();
        split.Resize += (_, _) => { if (!split.Panel2Collapsed) ApplyBrowserSplitLayout(); };
        split.SplitterMoved += (_, _) =>
        {
            if (applyingBrowserLayout || split.Panel2Collapsed) return;
            var width = Math.Max(0, split.ClientSize.Width - split.SplitterDistance - split.SplitterWidth);
            if (width > 0) browserWidthOverride = width;
        };
        if (initializeWebViewsOnShow)
            Shown += async (_, _) => await InitializeAsync();
        KeyDown += OnWindowKeyDown;
    }

    private void ApplyInitialSplitLayout()
    {
        split.Panel2Collapsed = BrowserLayout.StartCollapsed;
        if (!split.Panel2Collapsed)
            ApplyBrowserSplitLayout();
    }

    private void ApplyBrowserSplitLayout()
    {
        if (applyingBrowserLayout || split.Panel2Collapsed)
            return;

        var width = split.ClientSize.Width;
        if (width <= split.SplitterWidth + 2)
            return;

        applyingBrowserLayout = true;
        try
        {
            const int desiredLeftMin = BrowserLayout.MinimumChatWidth;
            const int desiredRightMin = BrowserLayout.MinimumBrowserWidth;
            var desiredBrowserWidth = browserWidthOverride ?? BrowserLayout.PreferredBrowserWidth(width);

            // Reset constraints before moving the splitter, then restore as much of the desired
            // geometry as the actual window width can safely accommodate.
            split.Panel1MinSize = 0;
            split.Panel2MinSize = 0;

            var maxDistance = Math.Max(1, width - desiredRightMin - split.SplitterWidth);
            var minDistance = Math.Min(desiredLeftMin, maxDistance);
            var desiredDistance = width - desiredBrowserWidth - split.SplitterWidth;
            var distance = Math.Clamp(desiredDistance, minDistance, maxDistance);
            split.SplitterDistance = distance;
            split.Panel1MinSize = Math.Min(desiredLeftMin, distance);

            var availableRight = Math.Max(0, width - distance - split.SplitterWidth);
            split.Panel2MinSize = Math.Min(desiredRightMin, availableRight);
        }
        finally
        {
            applyingBrowserLayout = false;
        }
    }

    internal void ShowAndActivate()
    {
        if (!Visible) Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
        BringToFront();
    }

    internal void PrepareForAppEntry()
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            try { BeginInvoke((Action)PrepareForAppEntry); } catch { }
            return;
        }

        // Re-entering Phoenix must never resurrect an old browser split as if it were the app
        // itself. Keep the browser session available in memory, but return the visible surface to
        // chat-first every time the user opens Phoenix from the EXE or tray.
        if (DesktopStartupContract.ReentryCollapsesBrowser && !split.Panel2Collapsed)
            SetBrowserVisible(false);

        RefreshPhoenixOnEntry();
    }

    internal void RefreshPhoenixOnEntry()
    {
        if (IsDisposed || !runtimeReady || phoenixView.CoreWebView2 is null) return;
        if (InvokeRequired)
        {
            try { BeginInvoke((Action)RefreshPhoenixOnEntry); } catch { }
            return;
        }

        // MarkRuntimeReady may have navigated moments before ShowWindow runs. Avoid a duplicate
        // first-load request while still guaranteeing that later tray/second-launch entries refresh.
        // A WebView navigation can also take longer than the debounce window, so never overlap an
        // in-flight loopback load with another Navigate() call.
        if (phoenixNavigationInFlight
            || DateTimeOffset.UtcNow - lastPhoenixNavigationAt < TimeSpan.FromSeconds(1))
            return;

        _ = NavigatePhoenixFreshAsync();
    }

    internal void MarkRuntimeUnavailable()
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            try { BeginInvoke((Action)MarkRuntimeUnavailable); } catch { }
            return;
        }

        runtimeReady = false;
    }

    internal void SetStartupStatus(string text, bool isError = false)
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            try { BeginInvoke((Action)(() => SetStartupStatus(text, isError))); } catch { }
            return;
        }

        startupStatus.Text = text;
        startupStatus.ForeColor = isError ? Color.Firebrick : SystemColors.ControlText;
        startupSpinner.ForeColor = isError ? Color.Firebrick : SystemColors.ControlText;
        startupOverlay.Visible = true;
        startupOverlay.BringToFront();
        if (!startupAnimationTimer.Enabled)
            startupAnimationTimer.Start();
    }

    internal void MarkRuntimeReady()
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            try { BeginInvoke((Action)MarkRuntimeReady); } catch { }
            return;
        }

        runtimeReady = true;
        phoenixNavigationRetryCount = 0;
        phoenixNavigationRetryScheduled = false;
        SetStartupStatus("Abriendo Phoenix…");
        if (phoenixView.CoreWebView2 is not null)
            _ = NavigatePhoenixFreshAsync();
    }

    private Task NavigatePhoenixFreshAsync()
    {
        var core = phoenixView.CoreWebView2;
        if (core is null || phoenixNavigationInFlight)
            return Task.CompletedTask;

        var navigationBase = DesktopPhoenixLoopback.NavigationBase(phoenixUri, phoenixNavigationRetryCount);
        var launchUri = new UriBuilder(navigationBase);
        var existingQuery = launchUri.Query.TrimStart('?');
        var prefix = string.IsNullOrWhiteSpace(existingQuery) ? string.Empty : existingQuery + "&";
        launchUri.Query = $"{prefix}surface=desktop&shellVersion={Uri.EscapeDataString(Application.ProductVersion)}&launch={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";

        // The launch query already cache-busts the HTML shell. Clearing the entire Chromium cache
        // here made every entry slower and, more importantly, inserted an await between deciding
        // to navigate and recording that navigation. MarkRuntimeReady + ShowWindow could therefore
        // issue two competing Navigate() calls and WebView2 sometimes surfaced the loser as Unknown.
        lastPhoenixNavigationAt = DateTimeOffset.UtcNow;
        phoenixNavigationInFlight = true;
        try
        {
            DesktopLog.Write($"Phoenix WebView navigating to {launchUri.Uri} (retry={phoenixNavigationRetryCount}).");
            core.Navigate(launchUri.Uri.ToString());
        }
        catch
        {
            phoenixNavigationInFlight = false;
            throw;
        }

        return Task.CompletedTask;
    }

    private async Task RetryPhoenixNavigationAsync(int attempt)
    {
        if (phoenixNavigationRetryScheduled || IsDisposed || !runtimeReady)
            return;

        phoenixNavigationRetryScheduled = true;
        try
        {
            await Task.Delay(DesktopNavigationRecovery.RetryDelayMilliseconds(attempt));
            if (IsDisposed || !runtimeReady || phoenixView.CoreWebView2 is null)
                return;

            await NavigatePhoenixFreshAsync();
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Phoenix WebView retry failed before navigation.", ex);
        }
        finally
        {
            phoenixNavigationRetryScheduled = false;
        }
    }

    internal Task ClearSessionAsync()
    {
        if (IsDisposed) return Task.CompletedTask;
        if (!InvokeRequired) return ClearSessionCoreAsync();

        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            BeginInvoke((Action)(async () =>
            {
                try
                {
                    await ClearSessionCoreAsync();
                    completion.SetResult();
                }
                catch (Exception ex)
                {
                    completion.SetException(ex);
                }
            }));
        }
        catch (Exception ex)
        {
            completion.SetException(ex);
        }
        return completion.Task;
    }

    private async Task ClearSessionCoreAsync()
    {
        var core = phoenixView.CoreWebView2;
        if (core is null) return;

        var origin = $"{phoenixUri.Scheme}://{phoenixUri.Host}:{phoenixUri.Port}";
        try
        {
            await core.CallDevToolsProtocolMethodAsync(
                "Storage.clearDataForOrigin",
                JsonSerializer.Serialize(new { origin, storageTypes = "all" }));
            await core.CallDevToolsProtocolMethodAsync("Network.clearBrowserCookies", "{}");
            await core.CallDevToolsProtocolMethodAsync("Network.clearBrowserCache", "{}");
        }
        finally
        {
            core.Navigate("about:blank");
        }
    }

    private void BuildStartupOverlay()
    {
        startupOverlay.Dock = DockStyle.Fill;
        startupOverlay.BackColor = SystemColors.Window;

        var spinnerFrames = new[] { "◐", "◓", "◑", "◒" };
        startupAnimationTimer.Tick += (_, _) =>
        {
            if (!startupOverlay.Visible)
            {
                startupAnimationTimer.Stop();
                return;
            }

            startupAnimationFrame = (startupAnimationFrame + 1) % spinnerFrames.Length;
            startupSpinner.Text = spinnerFrames[startupAnimationFrame];
        };

        var title = new Label
        {
            AutoSize = true,
            Text = "Phoenix",
            Font = new Font(SystemFonts.MessageBoxFont?.FontFamily ?? SystemFonts.DefaultFont.FontFamily, 28, FontStyle.Bold),
            ForeColor = SystemColors.ControlText,
            Anchor = AnchorStyles.None,
        };

        startupSpinner.AutoSize = true;
        startupSpinner.Text = spinnerFrames[0];
        startupSpinner.Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 20, FontStyle.Regular);
        startupSpinner.ForeColor = SystemColors.ControlText;

        startupStatus.AutoSize = false;
        startupStatus.TextAlign = ContentAlignment.MiddleCenter;
        startupStatus.Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 12, FontStyle.Regular);
        startupStatus.ForeColor = SystemColors.ControlText;
        startupStatus.Dock = DockStyle.Fill;
        startupStatus.Padding = new Padding(30, 125, 30, 30);
        startupStatus.Text = DesktopStartupContract.InitialStatus;

        startupOverlay.Controls.Add(startupStatus);
        startupOverlay.Controls.Add(startupSpinner);
        startupOverlay.Controls.Add(title);
        startupOverlay.Resize += (_, _) =>
        {
            title.Left = Math.Max(16, (startupOverlay.ClientSize.Width - title.Width) / 2);
            title.Top = Math.Max(32, (startupOverlay.ClientSize.Height / 2) - 105);
            startupSpinner.Left = Math.Max(16, (startupOverlay.ClientSize.Width - startupSpinner.Width) / 2);
            startupSpinner.Top = Math.Max(80, (startupOverlay.ClientSize.Height / 2) - 18);
        };
        startupAnimationTimer.Start();
    }

    private ToolStrip BuildBrowserToolbar()
    {
        var toolbar = new ToolStrip
        {
            Dock = DockStyle.Top,
            GripStyle = ToolStripGripStyle.Hidden,
            Stretch = true,
        };

        backButton.ToolTipText = "Atrás";
        forwardButton.ToolTipText = "Adelante";
        var reload = new ToolStripButton("↻") { ToolTipText = "Recargar" };
        var home = new ToolStripButton("⌂") { ToolTipText = "Inicio" };
        var go = new ToolStripButton("Ir");
        var close = new ToolStripButton("×") { Alignment = ToolStripItemAlignment.Right, ToolTipText = "Ocultar navegador (F9 para volver a abrir)" };

        address.AutoSize = false;
        address.Width = 260;
        address.ToolTipText = "Dirección o búsqueda";

        backButton.Click += (_, _) => { if (browserView.CanGoBack) browserView.GoBack(); };
        forwardButton.Click += (_, _) => { if (browserView.CanGoForward) browserView.GoForward(); };
        reload.Click += (_, _) =>
        {
            if (browserView.CoreWebView2 is not null)
                browserView.Reload();
        };
        home.Click += (_, _) => NavigateBrowser("about:blank");
        go.Click += (_, _) => NavigateBrowser(address.Text);
        close.Click += (_, _) => SetBrowserVisible(false);
        address.KeyDown += (_, e) =>
        {
            if (e.KeyCode != Keys.Enter) return;
            e.SuppressKeyPress = true;
            NavigateBrowser(address.Text);
        };

        toolbar.Items.Add(backButton);
        toolbar.Items.Add(forwardButton);
        toolbar.Items.Add(reload);
        toolbar.Items.Add(home);
        toolbar.Items.Add(new ToolStripSeparator());
        toolbar.Items.Add(address);
        toolbar.Items.Add(go);
        toolbar.Items.Add(close);
        return toolbar;
    }

    private async Task InitializeAsync()
    {
        if (initialized) return;
        initialized = true;

        // CoreWebView2Environment.CreateAsync can spend several seconds in synchronous native
        // startup before returning an incomplete Task on a cold profile. Yield once so the Shown
        // event can finish and Windows can paint the Phoenix startup surface before WebView2 does
        // any cold-start work. The installer pre-warms this profile, but portable/direct EXE
        // launches must remain visibly responsive too.
        await Task.Yield();

        try
        {
            var shellProfile = DesktopPhoenixLoopback.ShellProfilePath(Program.InstallRoot);
            Directory.CreateDirectory(shellProfile);
            var shellOptions = new CoreWebView2EnvironmentOptions
            {
                // The Phoenix shell only talks to the local runtime. Bypass Windows/VPN/system
                // proxies here so a proxy cannot turn a healthy 127.0.0.1 server into WebView2
                // "Unknown" navigation failures. The separate user browser WebView keeps normal
                // system proxy behavior.
                AdditionalBrowserArguments = DesktopPhoenixLoopback.ShellBrowserArguments,
            };
            DesktopLog.Write($"Initializing Phoenix WebView profile at {shellProfile} with {DesktopPhoenixLoopback.ShellBrowserArguments}.");
            var shellEnvironment = await CoreWebView2Environment.CreateAsync(null, shellProfile, shellOptions);
            await phoenixView.EnsureCoreWebView2Async(shellEnvironment);
            ConfigureWebView(phoenixView.CoreWebView2, isPhoenixSurface: true);
            phoenixView.CoreWebView2.WebMessageReceived += (_, e) => HandlePhoenixMessage(e.WebMessageAsJson, e.Source);
            phoenixView.CoreWebView2.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                if (e.IsUserInitiated)
                    OpenBrowser(e.Uri);
                else
                    DesktopLog.Write($"Blocked background new-window request from the Phoenix shell: {e.Uri}");
            };
            phoenixView.CoreWebView2.NavigationStarting += (_, e) =>
            {
                CancelPendingCredentialPrompts();
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var target)) return;
                if (IsPhoenixUri(target)) return;
                e.Cancel = true;
                if (e.IsUserInitiated)
                    OpenBrowser(target.ToString());
                else
                    DesktopLog.Write($"Blocked background external navigation from the Phoenix shell: {target}; canonical={phoenixUri}.");
            };
            phoenixView.CoreWebView2.NavigationCompleted += (_, e) =>
            {
                // Release the single-flight gate for every completion, including completions that
                // arrive while the runtime is being restarted.
                phoenixNavigationInFlight = false;
                if (!runtimeReady) return;
                if (e.IsSuccess)
                {
                    phoenixNavigationRetryCount = 0;
                    phoenixNavigationRetryScheduled = false;
                    startupOverlay.Visible = false;
                    startupAnimationTimer.Stop();
                    return;
                }

                var status = e.WebErrorStatus.ToString();
                if (DesktopNavigationRecovery.IsTransient(status)
                    && phoenixNavigationRetryCount < DesktopNavigationRecovery.MaxRetries)
                {
                    phoenixNavigationRetryCount++;
                    SetStartupStatus("Phoenix está terminando de iniciar…");
                    DesktopLog.Write($"Transient Phoenix WebView navigation failure: {status}; retry {phoenixNavigationRetryCount}/{DesktopNavigationRecovery.MaxRetries}.");
                    _ = RetryPhoenixNavigationAsync(phoenixNavigationRetryCount);
                    return;
                }

                var failedSource = phoenixView.Source?.ToString() ?? "(sin URL)";
                SetStartupStatus($"Phoenix está activo, pero la interfaz no pudo cargarse ({status}).\n\nPhoenix intentó reparar la conexión local automáticamente.\n\nDiagnóstico: {Program.LogPath}", isError: true);
                DesktopLog.Write($"Phoenix WebView navigation failed after retries: status={status}; source={failedSource}; retryCount={phoenixNavigationRetryCount}; profile={DesktopPhoenixLoopback.ShellProfilePath(Program.InstallRoot)}");
            };
            await phoenixView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript);

            // Chat-first startup: do not initialize the second Chromium surface here.
            // The browser pane is created lazily on the first page request so it cannot delay
            // conversation hydration or steal half of the first rendered frame.
            if (runtimeReady)
                await NavigatePhoenixFreshAsync();
        }
        catch (WebView2RuntimeNotFoundException ex)
        {
            DesktopLog.Write("WebView2 Runtime is not installed", ex);
            SetStartupStatus("Phoenix necesita Microsoft Edge WebView2 Runtime. Instálalo y vuelve a abrir Phoenix.", isError: true);
            MessageBox.Show(
                "Phoenix necesita Microsoft Edge WebView2 Runtime para mostrar el navegador embebido. Instala WebView2 Runtime y vuelve a abrir Phoenix.",
                "Phoenix · navegador embebido",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Embedded WebView initialization failed", ex);
            SetStartupStatus($"Phoenix no pudo iniciar su interfaz.\n\n{ex.Message}\n\nDiagnóstico: {Program.LogPath}", isError: true);
            MessageBox.Show(
                $"Phoenix no pudo iniciar el navegador embebido.\n\n{ex.Message}\n\nDiagnóstico: {Program.LogPath}",
                "Phoenix · navegador embebido",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private static void ConfigureWebView(CoreWebView2 core, bool isPhoenixSurface)
    {
        core.Settings.AreDefaultContextMenusEnabled = true;
        core.Settings.AreDevToolsEnabled = true;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = true;
        core.Settings.AreBrowserAcceleratorKeysEnabled = true;
        core.Settings.IsWebMessageEnabled = true;
        if (isPhoenixSurface)
            core.Settings.AreHostObjectsAllowed = false;
    }

    private void HandlePhoenixMessage(string json, string source)
    {
        var currentShellSource = phoenixView.Source?.ToString();
        if (currentShellSource is null
            || !DesktopCredentialPromptProtocol.IsTrustedShellMessageSource(source, currentShellSource, phoenixUri))
            return;

        if (DesktopCredentialPromptProtocol.TryParseReply(json, out var reply))
        {
            if (!pendingCredentialPrompts.TryGetValue(reply.RequestId, out var pending)
                || !DesktopCredentialPromptProtocol.MatchesRequest(pending.RequestId, pending.Origin, reply)
                || !string.Equals(pending.BrowserPageUri, browserView.Source?.AbsoluteUri, StringComparison.Ordinal)
                || !string.Equals(pending.Origin, BrowserNavigation.NormalizeCredentialOrigin(browserView.Source?.ToString()), StringComparison.Ordinal))
                return;
            pending.Completion.TrySetResult(reply);
            return;
        }

        if (!BrowserCommand.TryParse(json, out var command)) return;
        _ = ExecuteBrowserCommandAsync(command);
    }

    /// <summary>Ask through a temporary WebView2 modal without putting credentials in session input.</summary>
    private async Task<DesktopCredentialPromptReply> RequestCredentialPromptAsync(string rawOrigin)
    {
        var origin = BrowserNavigation.NormalizeCredentialOrigin(rawOrigin);
        if (origin is null || !origin.StartsWith("https://", StringComparison.Ordinal))
            throw new InvalidOperationException("Credential prompt requires an HTTPS page origin.");

        var browserPageUri = browserView.Source?.AbsoluteUri;
        if (browserPageUri is null
            || !string.Equals(origin, BrowserNavigation.NormalizeCredentialOrigin(browserView.Source?.ToString()), StringComparison.Ordinal))
            throw new InvalidOperationException("Embedded browser origin changed; refusing credential prompt.");

        var shellSource = phoenixView.Source?.ToString();
        var core = phoenixView.CoreWebView2;
        if (core is null || shellSource is null
            || !DesktopCredentialPromptProtocol.IsTrustedShellMessageSource(shellSource, shellSource, phoenixUri))
            throw new InvalidOperationException("Phoenix credential prompt is unavailable.");

        if (pendingCredentialPrompts.Count > 0)
            throw new InvalidOperationException("A credential prompt is already active.");

        var requestId = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<DesktopCredentialPromptReply>(TaskCreationOptions.RunContinuationsAsynchronously);
        var pending = new PendingCredentialPrompt(requestId, origin, browserPageUri, completion);
        pendingCredentialPrompts.Add(requestId, pending);
        try
        {
            ShowAndActivate();
            core.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                kind = "computer-credential",
                requestId,
                origin,
                legacyCredentialPresent = false,
            }));

            var reply = await completion.Task.WaitAsync(CredentialPromptTimeout);
            if (reply.Cancelled)
                throw new OperationCanceledException("Credential prompt was cancelled.");

            if (!string.Equals(browserPageUri, browserView.Source?.AbsoluteUri, StringComparison.Ordinal)
                || !string.Equals(origin, BrowserNavigation.NormalizeCredentialOrigin(browserView.Source?.ToString()), StringComparison.Ordinal))
                throw new OperationCanceledException("Embedded browser page changed while the credential prompt was open.");

            return reply;
        }
        catch (TimeoutException)
        {
            throw new InvalidOperationException("Credential prompt timed out.");
        }
        finally
        {
            pendingCredentialPrompts.Remove(requestId);
        }
    }

    private void CancelPendingCredentialPrompts()
    {
        if (pendingCredentialPrompts.Count == 0) return;
        foreach (var pending in pendingCredentialPrompts.Values.ToArray())
        {
            pending.Completion.TrySetCanceled();
            var core = phoenixView.CoreWebView2;
            if (core is null) continue;
            try
            {
                core.PostWebMessageAsJson(JsonSerializer.Serialize(new
                {
                    kind = "computer-credential-dismissed",
                    requestId = pending.RequestId,
                    origin = pending.Origin,
                }));
            }
            catch (InvalidOperationException)
            {
                // WebView2 may already be tearing down while the prompt is being dismissed.
            }
        }
    }

    /// <summary>
    /// Execute the same typed browser command whether it came from the Phoenix WebView bridge or
    /// from the model/runtime named-pipe control channel. Only the latter can parse automation
    /// command types; this method still re-checks the live page origin before every DOM mutation.
    /// </summary>
    internal Task<string?> ExecuteBrowserCommandAsync(BrowserCommand command)
    {
        if (IsDisposed)
            return Task.FromException<string?>(new ObjectDisposedException(nameof(PhoenixDesktopWindow)));

        if (!InvokeRequired)
            return ExecuteBrowserCommandCoreAsync(command);

        var completion = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            BeginInvoke((Action)(async () =>
            {
                try
                {
                    completion.SetResult(await ExecuteBrowserCommandCoreAsync(command));
                }
                catch (Exception ex)
                {
                    completion.SetException(ex);
                }
            }));
        }
        catch (Exception ex)
        {
            completion.SetException(ex);
        }
        return completion.Task;
    }

    private async Task<string?> ExecuteBrowserCommandCoreAsync(BrowserCommand command)
    {
        switch (command.Type)
        {
            case "phoenix.browser.open":
                await OpenBrowserAsync(command.Url, waitForCompletion: true);
                return null;
            case "phoenix.browser.inspect":
                return await InspectBrowserAsync();
            case "phoenix.browser.fill-form":
                return await FillBrowserFormAsync(command);
            case "phoenix.browser.login":
                return await FillBrowserCredentialsAsync(command);
            case "phoenix.browser.forget-credentials":
                return await ForgetBrowserCredentialsAsync(command);
            case "phoenix.browser.click-text":
                return await ClickBrowserTextAsync(command);
            default:
                ExecuteBrowserCommand(command);
                return null;
        }
    }

    private void ExecuteBrowserCommand(BrowserCommand command)
    {
        switch (command.Type)
        {
            case "phoenix.browser.close":
                SetBrowserVisible(false);
                break;
            case "phoenix.browser.back":
                if (browserView.CanGoBack) browserView.GoBack();
                break;
            case "phoenix.browser.forward":
                if (browserView.CanGoForward) browserView.GoForward();
                break;
            case "phoenix.browser.reload":
                if (browserView.CoreWebView2 is not null)
                    browserView.Reload();
                break;
            case "phoenix.browser.home":
                OpenBrowser("about:blank");
                break;
            case "phoenix.browser.focus":
                SetBrowserVisible(true);
                _ = EnsureBrowserInitializedAsync();
                browserView.Focus();
                break;
            case "phoenix.app.logout":
                LogoutRequested?.Invoke(this, EventArgs.Empty);
                break;
            default:
                throw new InvalidOperationException($"Unsupported browser command: {command.Type}");
        }
    }

    private async Task<CoreWebView2> RequireBrowserForOriginAsync(string? rawOrigin)
    {
        var expected = BrowserNavigation.NormalizeCredentialOrigin(rawOrigin)
            ?? throw new InvalidOperationException("Browser automation requires a secure origin.");
        await EnsureBrowserInitializedAsync();
        var core = browserView.CoreWebView2
            ?? throw new InvalidOperationException("Embedded browser is unavailable.");
        var live = BrowserNavigation.NormalizeCredentialOrigin(browserView.Source?.ToString());
        if (!string.Equals(expected, live, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Embedded browser origin changed; refusing origin-bound automation.");
        return core;
    }

    private static string DecodeScriptJson(string raw)
    {
        try
        {
            return JsonSerializer.Deserialize<string>(raw) ?? "{}";
        }
        catch (JsonException)
        {
            return "{}";
        }
    }

    private async Task<string> InspectBrowserAsync()
    {
        await EnsureBrowserInitializedAsync();
        var core = browserView.CoreWebView2
            ?? throw new InvalidOperationException("Embedded browser is unavailable.");
        var raw = await core.ExecuteScriptAsync(BrowserInspectScript);
        return DecodeScriptJson(raw);
    }

    private async Task<string> FillBrowserFormAsync(BrowserCommand command)
    {
        var core = await RequireBrowserForOriginAsync(command.Origin);
        var fields = command.Fields ?? throw new InvalidOperationException("Browser form fields are missing.");
        var fieldPayload = fields.Select(field => new
        {
            field = field.Field,
            value = field.Value,
            @checked = field.Checked,
        });
        var script = BrowserFillScript
            .Replace("__ORIGIN__", JsonSerializer.Serialize(command.Origin), StringComparison.Ordinal)
            .Replace("__FIELDS__", JsonSerializer.Serialize(fieldPayload), StringComparison.Ordinal)
            .Replace("__SUBMIT__", command.Submit ? "true" : "false", StringComparison.Ordinal);
        var raw = await core.ExecuteScriptAsync(script);
        return DecodeScriptJson(raw);
    }

    private async Task<string> ClickBrowserTextAsync(BrowserCommand command)
    {
        var core = await RequireBrowserForOriginAsync(command.Origin);
        var script = BrowserClickTextScript
            .Replace("__ORIGIN__", JsonSerializer.Serialize(command.Origin), StringComparison.Ordinal)
            .Replace("__TEXT__", JsonSerializer.Serialize(command.Text ?? string.Empty), StringComparison.Ordinal);
        var raw = await core.ExecuteScriptAsync(script);
        return DecodeScriptJson(raw);
    }

    private async Task<string> FillBrowserCredentialsAsync(BrowserCommand command)
    {
        var origin = CredentialOrigin.Normalize(command.Origin)
            ?? throw new InvalidOperationException("Credential fill requires a secure page origin.");
        if (!origin.StartsWith("https://", StringComparison.Ordinal))
            throw new InvalidOperationException("Credential fill requires HTTPS.");

        var core = await RequireBrowserForOriginAsync(origin);
        var broker = await GetCredentialBrokerAsync();
        if (!await broker.HasAsync(origin))
        {
            DesktopCredentialPromptReply? reply = await RequestCredentialPromptAsync(origin);
            if (reply.Cancelled || reply.Account is null || reply.Secret is null)
                throw new OperationCanceledException("Credential prompt was cancelled.");
            var account = reply.Account;
            var secret = reply.Secret;
            var remember = reply.Remember;
            await broker.StoreAsync(origin, account, secret, remember);
            account = string.Empty;
            secret = string.Empty;
            reply = null;
        }

        // The capability authorizes one read for one exact HTTPS origin and is consumed before
        // the credential reaches WebView2. Neither the Computer request nor its result has fields
        // for the returned account or secret.
        var capability = await broker.IssueFillCapabilityAsync(origin);
        DesktopCredentialValue? value = await broker.FillOnceAsync(origin, capability)
            ?? throw new InvalidOperationException("No saved credential is available for this origin.");
        core = await RequireBrowserForOriginAsync(origin);
        var script = BrowserCredentialFillScript
            .Replace("__ORIGIN__", JsonSerializer.Serialize(origin), StringComparison.Ordinal)
            .Replace("__ACCOUNT__", JsonSerializer.Serialize(value.Account), StringComparison.Ordinal)
            .Replace("__SECRET__", JsonSerializer.Serialize(value.Secret), StringComparison.Ordinal);
        value = null;
        var raw = await core.ExecuteScriptAsync(script);
        script = string.Empty;
        var result = DecodeScriptJson(raw);
        using var document = JsonDocument.Parse(result);
        if (!document.RootElement.TryGetProperty("ok", out var ok) || ok.ValueKind != JsonValueKind.True)
            throw new InvalidOperationException("The current page has no unambiguous sign-in fields.");
        return "Recognized sign-in fields filled. The form was not submitted.";
    }

    private async Task<string> ForgetBrowserCredentialsAsync(BrowserCommand command)
    {
        var origin = CredentialOrigin.Normalize(command.Origin)
            ?? throw new InvalidOperationException("Credential removal requires a secure page origin.");
        if (!origin.StartsWith("https://", StringComparison.Ordinal))
            throw new InvalidOperationException("Credential removal requires HTTPS.");
        _ = await RequireBrowserForOriginAsync(origin);
        var broker = await GetCredentialBrokerAsync();
        await broker.ForgetAsync(origin);
        return "Saved credentials were removed for this origin.";
    }

    private const string BrowserInspectScript = """
        (() => {
          const visible = (el) => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };
          const label = (el) => {
            const aria = el.getAttribute('aria-label');
            if (aria) return aria.slice(0, 300);
            if (el.id) {
              const bound = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
              if (bound?.innerText) return bound.innerText.trim().slice(0, 300);
            }
            const parent = el.closest('label');
            return (parent?.innerText || '').trim().slice(0, 300);
          };
          const nodes = Array.from(document.querySelectorAll('input,textarea,select'))
            .filter((el) => visible(el) && (el.getAttribute('type') || '').toLowerCase() !== 'hidden');
          const fields = nodes.map((el, index) => {
            const tag = el.tagName.toLowerCase();
            const type = (el.getAttribute('type') || tag).toLowerCase();
            const item = {
              field: index,
              tag,
              type,
              name: (el.getAttribute('name') || '').slice(0, 200),
              id: (el.id || '').slice(0, 200),
              label: label(el),
              placeholder: (el.getAttribute('placeholder') || '').slice(0, 300),
              autocomplete: (el.getAttribute('autocomplete') || '').slice(0, 100),
              required: !!el.required
            };
            if (tag === 'select') {
              item.options = Array.from(el.options).slice(0, 100).map((option) => ({
                text: (option.text || '').trim().slice(0, 200),
                value: String(option.value || '').slice(0, 200)
              }));
            }
            return item;
          });
          const buttons = Array.from(document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"]'))
            .filter(visible)
            .slice(0, 100)
            .map((el) => ({
              text: String(el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 300),
              tag: el.tagName.toLowerCase(),
              type: String(el.getAttribute('type') || '').toLowerCase()
            }));
          return JSON.stringify({
            origin: location.origin,
            url: location.href.slice(0, 4096),
            title: document.title.slice(0, 500),
            text: String(document.body?.innerText || '').slice(0, 12000),
            fields,
            buttons
          });
        })()
        """;

    private const string BrowserFillScript = """
        (() => {
          const expected = __ORIGIN__;
          if (location.origin !== expected) throw new Error('origin mismatch');
          const changes = __FIELDS__;
          const submit = __SUBMIT__;
          const visible = (el) => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };
          const nodes = Array.from(document.querySelectorAll('input,textarea,select'))
            .filter((el) => visible(el) && (el.getAttribute('type') || '').toLowerCase() !== 'hidden');
          const setValue = (el, value) => {
            const tag = el.tagName.toLowerCase();
            if (tag === 'select') {
              el.value = value;
            } else {
              const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
              if (descriptor?.set) descriptor.set.call(el, value);
              else el.value = value;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          const touchedForms = new Set();
          let filled = 0;
          const missing = [];
          const protectedFields = [];
          for (const change of changes) {
            const el = nodes[change.field];
            if (!el) {
              missing.push(change.field);
              continue;
            }
            const type = (el.getAttribute('type') || '').toLowerCase();
            if (type === 'password' || type === 'file') {
              protectedFields.push(change.field);
              continue;
            }
            if (change.checked !== null && change.checked !== undefined) {
              if (type !== 'checkbox' && type !== 'radio') {
                missing.push(change.field);
                continue;
              }
              el.checked = !!change.checked;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              setValue(el, String(change.value ?? ''));
            }
            if (el.form) touchedForms.add(el.form);
            filled++;
          }
          if (protectedFields.length) {
            throw new Error('protected credential/file fields must use their dedicated broker');
          }
          let submitted = false;
          if (submit) {
            if (touchedForms.size !== 1) throw new Error('submit requires all changed fields to belong to one form');
            const form = Array.from(touchedForms)[0];
            const actionOrigin = new URL(form.action || location.href, location.href).origin;
            if (actionOrigin !== expected) throw new Error('cross-origin form submit refused');
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.submit();
            submitted = true;
          }
          return JSON.stringify({ origin: location.origin, filled, missing, submitted });
        })()
        """;

    private const string BrowserClickTextScript = """
        (() => {
          const expected = __ORIGIN__;
          if (location.origin !== expected) throw new Error('origin mismatch');
          const wanted = String(__TEXT__).trim().replace(/\s+/g, ' ').toLowerCase();
          const visible = (el) => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };
          const candidates = Array.from(document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"]'))
            .filter(visible);
          const textOf = (el) => String(el.innerText || el.value || el.getAttribute('aria-label') || '')
            .trim().replace(/\s+/g, ' ');
          let match = candidates.find((el) => textOf(el).toLowerCase() === wanted);
          if (!match) match = candidates.find((el) => textOf(el).toLowerCase().includes(wanted));
          if (!match) return JSON.stringify({ origin: location.origin, clicked: false });
          const label = textOf(match).slice(0, 300);
          match.click();
          return JSON.stringify({ origin: location.origin, clicked: true, text: label });
        })()
        """;

    private const string BrowserCredentialFillScript = """
        (() => {
          const expected = __ORIGIN__;
          if (location.origin !== expected) return JSON.stringify({ ok: false });
          const visible = (el) => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return !el.disabled && !el.readOnly && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };
          const passwords = Array.from(document.querySelectorAll('input[type="password"]')).filter(visible);
          if (passwords.length !== 1) return JSON.stringify({ ok: false });
          const candidates = Array.from(document.querySelectorAll('input'))
            .filter((el) => visible(el) && !passwords.includes(el) && ['text', 'email', 'tel'].includes((el.type || '').toLowerCase()));
          const score = (el) => {
            const metadata = [el.autocomplete, el.name, el.id, el.getAttribute('aria-label'), el.placeholder]
              .join(' ').toLowerCase();
            let result = el.autocomplete.toLowerCase() === 'username' ? 8 : 0;
            if (el.type.toLowerCase() === 'email') result += 2;
            if (/(user|email|login|account|identifier)/u.test(metadata)) result += 4;
            if (/(search|phone|otp|code|token)/u.test(metadata)) result -= 8;
            return result;
          };
          const ranked = candidates.map((el) => ({ el, score: score(el) })).sort((a, b) => b.score - a.score);
          const account = ranked.length === 1
            ? ranked[0].el
            : ranked.length > 1 && ranked[0].score > 0 && ranked[0].score > ranked[1].score
              ? ranked[0].el
              : undefined;
          if (!account) return JSON.stringify({ ok: false });
          const setValue = (el, value) => {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (descriptor?.set) descriptor.set.call(el, value);
            else el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          setValue(account, __ACCOUNT__);
          setValue(passwords[0], __SECRET__);
          return JSON.stringify({ ok: true, submitted: false });
        })()
        """;

    private void OpenBrowser(string? value)
    {
        _ = OpenBrowserAsync(value, waitForCompletion: false);
    }

    private async Task OpenBrowserAsync(string? value, bool waitForCompletion)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        ShowAndActivate();
        SetBrowserVisible(true);
        var uri = BrowserNavigation.NormalizeAddress(value);
        if (uri is null) return;
        address.Text = uri.ToString();
        await NavigateBrowserAsync(uri, waitForCompletion);
    }

    private void NavigateBrowser(string value)
    {
        var uri = BrowserNavigation.NormalizeAddress(value);
        if (uri is null) return;
        address.Text = uri.ToString();
        _ = NavigateBrowserAsync(uri);
    }

    private async Task NavigateBrowserAsync(Uri uri, bool waitForCompletion = false)
    {
        try
        {
            await EnsureBrowserInitializedAsync();
            var core = browserView.CoreWebView2;
            if (core is null)
            {
                browserView.Source = uri;
                if (waitForCompletion)
                    throw new InvalidOperationException("Embedded browser did not initialize its WebView2 controller.");
                return;
            }

            if (!waitForCompletion)
            {
                core.Navigate(uri.ToString());
                return;
            }

            if (pendingBrowserNavigation is not null)
                throw new InvalidOperationException("Embedded browser already has a navigation in progress.");
            var completed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            pendingBrowserNavigation = completed;
            try
            {
                core.Navigate(uri.ToString());
                var success = await completed.Task.WaitAsync(TimeSpan.FromSeconds(15));
                if (!success)
                    throw new InvalidOperationException("Embedded browser navigation did not complete successfully.");
            }
            finally
            {
                if (ReferenceEquals(pendingBrowserNavigation, completed))
                    pendingBrowserNavigation = null;
            }
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Embedded browser navigation initialization failed", ex);
            if (waitForCompletion) throw;
        }
    }

    private Task EnsureBrowserInitializedAsync()
    {
        browserInitializationTask ??= InitializeBrowserAsync();
        return browserInitializationTask;
    }

    private async Task InitializeBrowserAsync()
    {
        var browserProfile = Path.Combine(Program.InstallRoot, "webview", "browser");
        Directory.CreateDirectory(browserProfile);
        var browserEnvironment = await CoreWebView2Environment.CreateAsync(null, browserProfile);
        await browserView.EnsureCoreWebView2Async(browserEnvironment);
        ConfigureWebView(browserView.CoreWebView2, isPhoenixSurface: false);
        browserView.CoreWebView2.NavigationStarting += (_, e) =>
        {
            CancelPendingCredentialPrompts();
            address.Text = e.Uri;
        };
        browserView.CoreWebView2.NavigationCompleted += (_, args) =>
        {
            pendingBrowserNavigation?.TrySetResult(args.IsSuccess);
            PublishBrowserState();
        };
        browserView.CoreWebView2.SourceChanged += (_, _) => PublishBrowserState();
        browserView.CoreWebView2.DocumentTitleChanged += (_, _) => PublishBrowserState();
        browserView.CoreWebView2.HistoryChanged += (_, _) => PublishBrowserState();
        browserView.CoreWebView2.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            OpenBrowser(e.Uri);
        };
        browserView.CoreWebView2.Navigate("about:blank");
        PublishBrowserState();
    }

    private void SetBrowserVisible(bool visible)
    {
        if (!visible) CancelPendingCredentialPrompts();
        var opening = visible && split.Panel2Collapsed;
        split.Panel2Collapsed = !visible;
        if (visible)
        {
            // Every newly-opened browser pane starts at the requested 60/40 split. A user can
            // still drag the splitter while it remains open; closing/reopening resets the default.
            if (opening) browserWidthOverride = null;
            ApplyBrowserSplitLayout();
            _ = EnsureBrowserInitializedAsync();
        }
        PublishBrowserState();
    }

    private bool IsPhoenixUri(Uri target)
    {
        // The local runtime may legitimately redirect between 127.0.0.1, localhost and ::1.
        // Treat all loopback aliases on Phoenix's port as the same trusted local origin.
        return DesktopPhoenixLoopback.IsPhoenixOrigin(target, phoenixUri);
    }

    private void PublishBrowserState()
    {
        if (browserView.CoreWebView2 is null || phoenixView.CoreWebView2 is null) return;
        backButton.Enabled = browserView.CanGoBack;
        forwardButton.Enabled = browserView.CanGoForward;
        var current = browserView.Source?.ToString() ?? "about:blank";
        address.Text = current;
        var payload = JsonSerializer.Serialize(new
        {
            type = "phoenix.browser.state",
            open = !split.Panel2Collapsed,
            url = current,
            title = browserView.CoreWebView2.DocumentTitle ?? string.Empty,
            canGoBack = browserView.CanGoBack,
            canGoForward = browserView.CanGoForward,
        });
        phoenixView.CoreWebView2.PostWebMessageAsJson(payload);
    }

    private void OnWindowKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.KeyCode == Keys.F9)
        {
            SetBrowserVisible(split.Panel2Collapsed);
            e.Handled = true;
            return;
        }

        if (e.Control && e.KeyCode == Keys.L)
        {
            SetBrowserVisible(true);
            address.Focus();
            address.SelectAll();
            e.SuppressKeyPress = true;
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            CancelPendingCredentialPrompts();
            startupAnimationTimer.Dispose();
        }
        base.Dispose(disposing);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (DesktopStartupContract.UserCloseHidesToTray && e.CloseReason == CloseReason.UserClosing)
        {
            CancelPendingCredentialPrompts();
            e.Cancel = true;
            Hide();
            DesktopLog.Write("Phoenix window closed by user; shell hidden to tray while runtime remains active.");
            return;
        }
        base.OnFormClosing(e);
    }

    private const string BridgeScript = """
        (() => {
          if (window.phoenixDesktop?.browser) return;
          const send = (type, url) => {
            const message = url === undefined ? { type } : { type, url };
            window.chrome?.webview?.postMessage(message);
          };
          const browser = Object.freeze({
            open: (url) => send('phoenix.browser.open', String(url ?? '')),
            close: () => send('phoenix.browser.close'),
            back: () => send('phoenix.browser.back'),
            forward: () => send('phoenix.browser.forward'),
            reload: () => send('phoenix.browser.reload'),
            home: () => send('phoenix.browser.home'),
            focus: () => send('phoenix.browser.focus')
          });
          const app = Object.freeze({
            logout: () => send('phoenix.app.logout')
          });
          const surface = Object.freeze({
            kind: 'desktop',
            nativeShell: true,
            embeddedBrowser: 'webview2',
            automationBrowser: 'chrome'
          });
          Object.defineProperty(window, 'phoenixDesktop', {
            value: Object.freeze({ browser, app, surface }),
            configurable: false,
            enumerable: true,
            writable: false
          });
        })();
        """;
}
