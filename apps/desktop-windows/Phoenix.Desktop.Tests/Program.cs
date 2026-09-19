using System.IO.Pipes;
using System.Text;
using Phoenix.Desktop;

var failures = new List<string>();

static void Equal(string? expected, string? actual, string name, List<string> failures)
{
    if (!string.Equals(expected, actual, StringComparison.Ordinal))
        failures.Add($"{name}: expected '{expected}', got '{actual}'");
}

static void True(bool value, string name, List<string> failures)
{
    if (!value) failures.Add($"{name}: expected true");
}

static void False(bool value, string name, List<string> failures)
{
    if (value) failures.Add($"{name}: expected false");
}

static void EqualInt(int expected, int actual, string name, List<string> failures)
{
    if (expected != actual) failures.Add($"{name}: expected '{expected}', got '{actual}'");
}

Equal("https://example.com/", BrowserNavigation.NormalizeAddress("example.com")?.ToString(), "hostname uses https", failures);
Equal("http://localhost:3080/", BrowserNavigation.NormalizeAddress("localhost:3080")?.ToString(), "localhost uses http", failures);
Equal("http://127.0.0.1:3080/", BrowserNavigation.NormalizeAddress("127.0.0.1:3080")?.ToString(), "loopback uses http", failures);
Equal("https://www.bing.com/search?q=phoenix+embedded+browser", BrowserNavigation.NormalizeAddress("phoenix embedded browser")?.ToString(), "free text becomes search", failures);
Equal("about:blank", BrowserNavigation.NormalizeAddress("about:blank")?.ToString(), "about blank allowed", failures);
Equal(null, BrowserNavigation.NormalizeAddress("javascript:alert(1)")?.ToString(), "javascript scheme rejected", failures);
Equal(null, BrowserNavigation.NormalizeAddress("data:text/html,boom")?.ToString(), "data scheme rejected", failures);
Equal(null, BrowserNavigation.NormalizeAddress("file:///C:/Windows/System32")?.ToString(), "file scheme rejected", failures);

True(BrowserCommand.TryParse("{\"type\":\"phoenix.browser.open\",\"url\":\"https://example.com\"}", out var open), "open command parses", failures);
Equal("phoenix.browser.open", open.Type, "open command type", failures);
Equal("https://example.com", open.Url, "open command url", failures);

True(BrowserCommand.TryParse("{\"type\":\"phoenix.browser.close\"}", out var close), "close command parses", failures);
Equal("phoenix.browser.close", close.Type, "close command type", failures);
Equal(null, close.Url, "close command has no url", failures);

True(BrowserCommand.TryParse("{\"type\":\"phoenix.app.logout\"}", out var logout), "native logout command parses", failures);
Equal("phoenix.app.logout", logout.Type, "native logout command type", failures);
Equal(null, logout.Url, "native logout command has no url", failures);

False(BrowserCommand.TryParse("{not-json}", out _), "malformed json rejected", failures);
False(BrowserCommand.TryParse("{\"type\":\"phoenix.browser.open\",\"url\":\"javascript:alert(1)\"}", out _), "unsafe open command rejected", failures);

False(BrowserCommand.TryParse("{\"type\":\"unknown\"}", out _), "unknown command rejected", failures);

// The model/runtime must control the embedded WebView through a direct current-user named pipe.
// This prevents browser_open from falling back to global Ctrl+L/type/Enter input.
var controlDescriptorPath = Path.Combine(Path.GetTempPath(), $"phoenix-desktop-control-{Guid.NewGuid():N}.json");
BrowserCommand? receivedControlCommand = null;
using (var control = new DesktopBrowserControlServer(
    command =>
    {
        receivedControlCommand = command;
        return Task.CompletedTask;
    },
    controlDescriptorPath))
{
    var descriptorJson = await File.ReadAllTextAsync(controlDescriptorPath);
    True(
        DesktopBrowserControlDescriptor.TryParse(descriptorJson, out var descriptor),
        "desktop control descriptor parses",
        failures);
    Equal(control.PipeName, descriptor.PipeName, "desktop control descriptor names live pipe", failures);
    EqualInt(1, descriptor.Schema, "desktop control descriptor schema", failures);

    using var client = new NamedPipeClientStream(
        ".",
        control.PipeName,
        PipeDirection.InOut,
        PipeOptions.Asynchronous);
    await client.ConnectAsync(3_000);
    using var writer = new StreamWriter(client, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
    using var reader = new StreamReader(client, Encoding.UTF8, leaveOpen: true);
    await writer.WriteLineAsync("{\"type\":\"phoenix.browser.open\",\"url\":\"https://example.com\"}");
    Equal("{\"ok\":true}", await reader.ReadLineAsync(), "desktop control acknowledges accepted command", failures);

    for (var attempt = 0; attempt < 30 && receivedControlCommand is null; attempt++)
        await Task.Delay(10);
    Equal("phoenix.browser.open", receivedControlCommand?.Type, "desktop control dispatches browser command", failures);
    Equal("https://example.com", receivedControlCommand?.Url, "desktop control preserves browser URL", failures);
}
False(File.Exists(controlDescriptorPath), "desktop control descriptor removed on dispose", failures);

True(BrowserLayout.StartCollapsed, "embedded browser starts collapsed", failures);
EqualInt(400, BrowserLayout.PreferredBrowserWidth(1100), "small window keeps useful browser without crowding chat", failures);
EqualInt(518, BrowserLayout.PreferredBrowserWidth(1440), "normal window uses a Codex-like side pane", failures);
EqualInt(640, BrowserLayout.PreferredBrowserWidth(2400), "wide window caps browser width", failures);

// Desktop startup must be visible before the managed runtime is ready. This is the regression
// contract for the installed EXE appearing to do nothing on first launch.
True(DesktopStartupContract.ShowWindowBeforeRuntimeReady, "desktop window is shown before runtime readiness", failures);
True(DesktopStartupContract.SecondLaunchSignalsExistingWindow, "second launch signals existing window", failures);
True(DesktopStartupContract.EmbeddedBrowserStartsLazy, "embedded browser does not delay chat startup", failures);
Equal("Preparando Phoenix…", DesktopStartupContract.InitialStatus, "startup status is explicit", failures);

var runtimeLaunch = DesktopRuntimeLaunchContract.CreateOwnedRuntimeStartInfo(
    @"C:\Phoenix Runtime",
    @"C:\Phoenix\desktop-control.json");
Equal("powershell.exe", runtimeLaunch.FileName, "desktop runtime uses PowerShell", failures);
True(runtimeLaunch.CreateNoWindow, "PowerShell backend stays out of the chat surface", failures);
False(runtimeLaunch.UseShellExecute, "PowerShell runtime is directly supervised", failures);
True(runtimeLaunch.ArgumentList.Contains("-NoProfile"), "PowerShell disables user profile side effects", failures);
True(runtimeLaunch.ArgumentList.Contains("-NonInteractive"), "PowerShell runtime is non-interactive", failures);
True(runtimeLaunch.ArgumentList.Any(value => value.Contains("phoenix-windows.cmd", StringComparison.OrdinalIgnoreCase)), "PowerShell invokes Windows supervisor launcher", failures);
True(runtimeLaunch.ArgumentList.Any(value => value.Contains("--port 3081", StringComparison.Ordinal)), "desktop runtime owns isolated port 3081", failures);
True(runtimeLaunch.ArgumentList.Any(value => value.Contains("--no-open", StringComparison.Ordinal)), "desktop runtime never opens an external browser", failures);
Equal("1", runtimeLaunch.Environment["PHOENIX_DESKTOP_MANAGED"], "desktop managed environment is preserved", failures);
Equal(@"C:\Phoenix\desktop-control.json", runtimeLaunch.Environment["PHOENIX_DESKTOP_CONTROL_DESCRIPTOR"], "desktop control descriptor reaches supervisor", failures);
Equal("desktop", runtimeLaunch.Environment["PHOENIX_SURFACE"], "runtime knows it is hosted by the desktop shell", failures);
Equal("1", runtimeLaunch.Environment["PHOENIX_DESKTOP_SHELL"], "desktop shell marker reaches runtime", failures);
Equal("true", runtimeLaunch.Environment["PHOENIX_BROWSER_AUTOSTART"], "desktop automation browser may start on demand", failures);
Equal("chrome", runtimeLaunch.Environment["PHOENIX_BROWSER_PREFERRED_ENGINE"], "desktop prefers Chrome automation", failures);

// A managed runtime is healthy only after install/build completed. Old desktop builds could leave
// an empty marker behind before those steps completed; that state must never be accepted as ready.
True(ManagedRuntimeMarker.IsReadyContent("schema=1\nstate=ready\ninstalledAt=2026-09-17T00:00:00Z"), "completed runtime marker accepted", failures);
False(ManagedRuntimeMarker.IsReadyContent(""), "empty legacy marker rejected", failures);
False(ManagedRuntimeMarker.IsReadyContent("schema=1\ninstalledAt=2026-09-17T00:00:00Z"), "marker without ready state rejected", failures);

if (failures.Count == 0)
{
    Console.WriteLine("Embedded browser and desktop startup contract checks passed.");
    return 0;
}

Console.Error.WriteLine($"Embedded browser and desktop startup contract checks failed: {failures.Count}");
foreach (var failure in failures) Console.Error.WriteLine($" - {failure}");
return 1;
