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
    private readonly Uri phoenixUri;
    private readonly SplitContainer split = new();
    private readonly WebView2 phoenixView = new();
    private readonly WebView2 browserView = new();
    private readonly ToolStripTextBox address = new();
    private readonly ToolStripButton backButton = new("←");
    private readonly ToolStripButton forwardButton = new("→");
    private readonly Panel startupOverlay = new();
    private readonly Label startupStatus = new();
    private bool initialized;
    private bool runtimeReady;
    private bool applyingBrowserLayout;
    private int? browserWidthOverride;
    private Task? browserInitializationTask;

    // Exposed to the native smoke test so CI verifies the real SplitContainer state,
    // not only the pure layout contract.
    internal bool IsBrowserPaneVisible => !split.Panel2Collapsed;

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
        startupOverlay.Visible = true;
        startupOverlay.BringToFront();
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
        SetStartupStatus("Abriendo Phoenix…");
        if (phoenixView.CoreWebView2 is not null)
            phoenixView.CoreWebView2.Navigate(phoenixUri.ToString());
    }

    private void BuildStartupOverlay()
    {
        startupOverlay.Dock = DockStyle.Fill;
        startupOverlay.BackColor = SystemColors.Window;

        var title = new Label
        {
            AutoSize = true,
            Text = "Phoenix",
            Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 28, FontStyle.Bold),
            ForeColor = SystemColors.ControlText,
            Anchor = AnchorStyles.None,
        };

        startupStatus.AutoSize = false;
        startupStatus.TextAlign = ContentAlignment.MiddleCenter;
        startupStatus.Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 12, FontStyle.Regular);
        startupStatus.ForeColor = SystemColors.ControlText;
        startupStatus.Dock = DockStyle.Fill;
        startupStatus.Padding = new Padding(30, 90, 30, 30);
        startupStatus.Text = DesktopStartupContract.InitialStatus;

        startupOverlay.Controls.Add(startupStatus);
        startupOverlay.Controls.Add(title);
        startupOverlay.Resize += (_, _) =>
        {
            title.Left = Math.Max(16, (startupOverlay.ClientSize.Width - title.Width) / 2);
            title.Top = Math.Max(32, (startupOverlay.ClientSize.Height / 2) - 90);
        };
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
        reload.Click += (_, _) => browserView.Reload();
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

        try
        {
            await phoenixView.EnsureCoreWebView2Async();
            ConfigureWebView(phoenixView.CoreWebView2, isPhoenixSurface: true);
            phoenixView.CoreWebView2.WebMessageReceived += (_, e) => HandlePhoenixMessage(e.WebMessageAsJson);
            phoenixView.CoreWebView2.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                OpenBrowser(e.Uri);
            };
            phoenixView.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var target)) return;
                if (IsPhoenixUri(target)) return;
                e.Cancel = true;
                OpenBrowser(target.ToString());
            };
            phoenixView.CoreWebView2.NavigationCompleted += (_, e) =>
            {
                if (!runtimeReady) return;
                if (e.IsSuccess)
                {
                    startupOverlay.Visible = false;
                }
                else
                {
                    SetStartupStatus($"Phoenix está activo, pero la interfaz no pudo cargarse ({e.WebErrorStatus}).\n\nDiagnóstico: {Program.LogPath}", isError: true);
                    DesktopLog.Write($"Phoenix WebView navigation failed: {e.WebErrorStatus}");
                }
            };
            await phoenixView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript);

            // Chat-first startup: do not initialize the second Chromium surface here.
            // The browser pane is created lazily on the first page request so it cannot delay
            // conversation hydration or steal half of the first rendered frame.
            if (runtimeReady)
                phoenixView.CoreWebView2.Navigate(phoenixUri.ToString());
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

    private void HandlePhoenixMessage(string json)
    {
        if (!BrowserCommand.TryParse(json, out var command)) return;
        _ = ExecuteBrowserCommandAsync(command);
    }

    /// <summary>
    /// Execute the same typed browser command whether it came from the Phoenix WebView bridge or
    /// from the model/runtime named-pipe control channel.
    /// </summary>
    internal Task ExecuteBrowserCommandAsync(BrowserCommand command)
    {
        if (IsDisposed)
            return Task.FromException(new ObjectDisposedException(nameof(PhoenixDesktopWindow)));

        if (!InvokeRequired)
        {
            ExecuteBrowserCommand(command);
            return Task.CompletedTask;
        }

        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            BeginInvoke((Action)(() =>
            {
                try
                {
                    ExecuteBrowserCommand(command);
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

    private void ExecuteBrowserCommand(BrowserCommand command)
    {
        switch (command.Type)
        {
            case "phoenix.browser.open":
                OpenBrowser(command.Url);
                break;
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
            default:
                throw new InvalidOperationException($"Unsupported browser command: {command.Type}");
        }
    }

    private void OpenBrowser(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        ShowAndActivate();
        SetBrowserVisible(true);
        NavigateBrowser(value);
    }

    private void NavigateBrowser(string value)
    {
        var uri = BrowserNavigation.NormalizeAddress(value);
        if (uri is null) return;
        address.Text = uri.ToString();
        _ = NavigateBrowserAsync(uri);
    }

    private async Task NavigateBrowserAsync(Uri uri)
    {
        try
        {
            await EnsureBrowserInitializedAsync();
            if (browserView.CoreWebView2 is not null)
                browserView.CoreWebView2.Navigate(uri.ToString());
            else
                browserView.Source = uri;
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Embedded browser navigation initialization failed", ex);
        }
    }

    private Task EnsureBrowserInitializedAsync()
    {
        browserInitializationTask ??= InitializeBrowserAsync();
        return browserInitializationTask;
    }

    private async Task InitializeBrowserAsync()
    {
        await browserView.EnsureCoreWebView2Async();
        ConfigureWebView(browserView.CoreWebView2, isPhoenixSurface: false);
        browserView.CoreWebView2.NavigationStarting += (_, e) => address.Text = e.Uri;
        browserView.CoreWebView2.NavigationCompleted += (_, _) => PublishBrowserState();
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
        split.Panel2Collapsed = !visible;
        if (visible)
            ApplyBrowserSplitLayout();
        PublishBrowserState();
    }

    private bool IsPhoenixUri(Uri target)
    {
        return target.Scheme.Equals(phoenixUri.Scheme, StringComparison.OrdinalIgnoreCase)
            && target.Host.Equals(phoenixUri.Host, StringComparison.OrdinalIgnoreCase)
            && target.Port == phoenixUri.Port;
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

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
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
          Object.defineProperty(window, 'phoenixDesktop', {
            value: Object.freeze({ browser }),
            configurable: false,
            enumerable: true,
            writable: false
          });
        })();
        """;
}
