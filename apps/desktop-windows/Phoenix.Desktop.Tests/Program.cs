using System.IO.Compression;
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

static async Task<bool> VerifyCredentialBrokerAsync(string brokerExecutable)
{
    var profileName = $"probe-{Guid.NewGuid():N}";
    var persistentOrigin = $"https://{Guid.NewGuid():N}.phoenix.invalid";
    var transientOrigin = $"https://{Guid.NewGuid():N}.phoenix.invalid";
    const string account = "phoenix-synthetic-account";
    const string secret = "phoenix-synthetic-secret";
    var results = new Dictionary<string, bool>(StringComparer.Ordinal);
    DesktopCredentialBrokerProcess? broker = null;

    try
    {
        broker = await DesktopCredentialBrokerProcess.StartAsync(brokerExecutable, profileName);
        results["starts_empty"] = !await broker.HasAsync(persistentOrigin);
        var diagnosticRequest = DesktopCredentialRequest.Create(
            persistentOrigin,
            CredentialBrokerOperations.Store,
            TimeSpan.FromSeconds(30),
            account: account,
            secret: secret,
            remember: true);
        results["redacts_request_diagnostics"] = !diagnosticRequest.ToString().Contains(secret, StringComparison.Ordinal)
            && !diagnosticRequest.ToString().Contains(account, StringComparison.Ordinal);
        await broker.StoreAsync(persistentOrigin, account, secret, remember: true);
        results["stores_persistently"] = await broker.HasAsync(persistentOrigin);
        results["isolates_origin"] = !await broker.HasAsync(transientOrigin);

        var capability = await broker.IssueFillCapabilityAsync(persistentOrigin);
        results["redacts_capability_diagnostics"] = !capability.ToString().Contains(capability.Token, StringComparison.Ordinal);
        var credential = await broker.FillOnceAsync(persistentOrigin, capability);
        results["fills_once"] = credential?.Account == account && credential.Secret == secret;
        results["redacts_credential_diagnostics"] = credential is not null
            && !credential.ToString().Contains(secret, StringComparison.Ordinal)
            && !credential.ToString().Contains(account, StringComparison.Ordinal);
        var replayRejected = false;
        try
        {
            _ = await broker.FillOnceAsync(persistentOrigin, capability);
        }
        catch (InvalidOperationException)
        {
            replayRejected = true;
        }
        results["rejects_replayed_capability"] = replayRejected;

        await broker.DisposeAsync();
        broker = await DesktopCredentialBrokerProcess.StartAsync(brokerExecutable, profileName);
        results["persists_across_broker_restart"] = await broker.HasAsync(persistentOrigin);
        var restartCapability = await broker.IssueFillCapabilityAsync(persistentOrigin);
        var restartedCredential = await broker.FillOnceAsync(persistentOrigin, restartCapability);
        results["fills_after_restart"] = restartedCredential?.Account == account && restartedCredential.Secret == secret;

        var oversizedSecretRejected = false;
        try
        {
            await broker.StoreAsync(persistentOrigin, account, new string('x', 513), remember: true);
        }
        catch (ArgumentException)
        {
            oversizedSecretRejected = true;
        }
        results["rejects_oversized_persistent_secret"] = oversizedSecretRejected;

        await broker.ForgetAsync(persistentOrigin);
        results["forgets_persistent_credential"] = !await broker.HasAsync(persistentOrigin);
        await broker.StoreAsync(transientOrigin, account, secret, remember: false);
        var transientCapability = await broker.IssueFillCapabilityAsync(transientOrigin);
        var transientCredential = await broker.FillOnceAsync(transientOrigin, transientCapability);
        results["fills_transient_credential"] = transientCredential?.Account == account && transientCredential.Secret == secret;
        results["consumes_transient_credential"] = !await broker.HasAsync(transientOrigin);

        await broker.DisposeAsync();
        broker = await DesktopCredentialBrokerProcess.StartAsync(brokerExecutable, profileName);
        results["does_not_persist_transient_credential"] = !await broker.HasAsync(transientOrigin);
        await broker.ForgetAsync(persistentOrigin);
        await broker.ForgetAsync(transientOrigin);
    }
    catch (Exception exception)
    {
        Console.Error.WriteLine($"Credential broker probe stopped: {exception.GetType().Name}");
        results["completed"] = false;
    }
    finally
    {
        if (broker is not null)
        {
            try
            {
                await broker.ForgetAsync(persistentOrigin);
                await broker.ForgetAsync(transientOrigin);
            }
            catch (Exception exception)
            {
                Console.Error.WriteLine($"Credential broker cleanup failed: {exception.GetType().Name}");
                results["cleanup"] = false;
            }
            await broker.DisposeAsync();
        }
    }

    foreach (var result in results)
        Console.WriteLine($"credential-broker-{result.Key}={result.Value}");
    return results.Count > 0 && results.Values.All(static passed => passed);
}

if (args.Length != 0)
{
    if (args.Length != 2 || args[0] != "--credential-broker-probe" || !OperatingSystem.IsWindows())
    {
        Console.Error.WriteLine("Usage: Phoenix.Desktop.Tests --credential-broker-probe <broker executable>");
        return 2;
    }

    return await VerifyCredentialBrokerAsync(args[1]) ? 0 : 1;
}

Equal("https://example.com/", BrowserNavigation.NormalizeAddress("example.com")?.ToString(), "hostname uses https", failures);
Equal("http://localhost:3080/", BrowserNavigation.NormalizeAddress("localhost:3080")?.ToString(), "localhost uses http", failures);
Equal("http://127.0.0.1:3080/", BrowserNavigation.NormalizeAddress("127.0.0.1:3080")?.ToString(), "loopback uses http", failures);
Equal("https://www.bing.com/search?q=phoenix+embedded+browser", BrowserNavigation.NormalizeAddress("phoenix embedded browser")?.ToString(), "free text becomes search", failures);
Equal("about:blank", BrowserNavigation.NormalizeAddress("about:blank")?.ToString(), "about blank allowed", failures);
Equal(null, BrowserNavigation.NormalizeAddress("javascript:alert(1)")?.ToString(), "javascript scheme rejected", failures);
Equal(null, BrowserNavigation.NormalizeAddress("data:text/html,boom")?.ToString(), "data scheme rejected", failures);
Equal(null, BrowserNavigation.NormalizeAddress("file:///C:/Windows/System32")?.ToString(), "file scheme rejected", failures);

Equal("https://example.com", BrowserNavigation.NormalizeCredentialOrigin("https://Example.com/login?next=1"), "credential origin canonicalizes https", failures);
Equal("http://localhost:3080", BrowserNavigation.NormalizeCredentialOrigin("http://localhost:3080/login"), "credential origin allows loopback http", failures);
Equal(null, BrowserNavigation.NormalizeCredentialOrigin("http://example.com/login"), "credential origin rejects remote http", failures);
Equal(null, BrowserNavigation.NormalizeCredentialOrigin("https://user@example.com/login"), "credential origin rejects user info", failures);

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

False(
    BrowserCommand.TryParse("{\"type\":\"phoenix.browser.inspect\"}", out _),
    "web bridge cannot invoke automation commands",
    failures);
True(
    BrowserCommand.TryParse(
        "{\"type\":\"phoenix.browser.inspect\"}",
        out var inspect,
        allowAutomation: true),
    "runtime pipe admits browser inspection",
    failures);
Equal("phoenix.browser.inspect", inspect.Type, "inspection command type", failures);
True(
    BrowserCommand.TryParse(
        "{\"type\":\"phoenix.browser.fill-form\",\"origin\":\"https://example.com/form\",\"fields\":[{\"field\":0,\"value\":\"synthetic-value\"}],\"submit\":true}",
        out var fill,
        allowAutomation: true),
    "runtime pipe admits origin-bound form filling",
    failures);
Equal("https://example.com", fill.Origin, "form origin canonicalized", failures);
True(fill.Submit, "form submit preserved", failures);
EqualInt(1, fill.Fields?.Count ?? 0, "form field count preserved", failures);
True(
    BrowserCommand.TryParse(
        "{\"type\":\"phoenix.browser.click-text\",\"origin\":\"https://example.com\",\"text\":\"Continue\"}",
        out var clickText,
        allowAutomation: true),
    "runtime pipe admits origin-bound text click",
    failures);
Equal("Continue", clickText.Text, "click text preserved", failures);
True(
    BrowserCommand.TryParse(
        "{\"type\":\"phoenix.browser.login\",\"origin\":\"https://example.com\"}",
        out var browserLogin,
        allowAutomation: true),
    "runtime pipe admits native broker login without credential fields",
    failures);
Equal("https://example.com", browserLogin.Origin, "native login origin is canonical", failures);
True(
    BrowserCommand.TryParse(
        "{\"type\":\"phoenix.browser.forget-credentials\",\"origin\":\"https://example.com\"}",
        out var forgetCredentials,
        allowAutomation: true),
    "runtime pipe admits origin-bound vault removal",
    failures);
Equal("https://example.com", forgetCredentials.Origin, "vault removal origin is canonical", failures);
False(
    BrowserCommand.TryParse(
        "{\"type\":\"phoenix.browser.login\",\"origin\":\"https://example.com/login\",\"account\":\"unit-user\",\"secret\":\"synthetic-login-secret\"}",
        out _,
        allowAutomation: true),
    "legacy browser login with inline credentials is rejected",
    failures);
False(
    BrowserCommand.TryParse(
        "{\"type\":\"phoenix.browser.login\",\"origin\":\"http://example.com\",\"account\":\"unit-user\",\"secret\":\"synthetic-login-secret\"}",
        out _,
        allowAutomation: true),
    "runtime pipe rejects insecure remote login origin",
    failures);

True(
    DesktopComputerRequest.TryParse(
        "{\"schema\":2,\"requestId\":\"r1\",\"type\":\"click\",\"x\":12,\"y\":34,\"button\":\"right\",\"capture\":true}",
        out var computerClick),
    "schema 2 desktop click parses",
    failures);
Equal("r1", computerClick.RequestId, "schema 2 request id is preserved", failures);
Equal("right", computerClick.Button, "schema 2 mouse button is preserved", failures);
True(computerClick.Capture, "schema 2 capture flag is preserved", failures);
True(
    DesktopComputerRequest.TryParse(
        "{\"schema\":2,\"requestId\":\"r-login\",\"type\":\"browser_login\",\"origin\":\"https://example.com\"}",
        out var computerLogin),
    "schema 2 admits origin-bound broker login without credential fields",
    failures);
Equal("https://example.com", computerLogin.Origin, "resident login origin is canonical", failures);
False(
    DesktopComputerRequest.TryParse(
        "{\"schema\":2,\"requestId\":\"r-login-capture\",\"type\":\"browser_login\",\"origin\":\"https://example.com\",\"capture\":true}",
        out _),
    "schema 2 refuses screenshots on a credential fill action",
    failures);
False(
    DesktopComputerRequest.TryParse(
        "{\"schema\":2,\"requestId\":\"r-login-http\",\"type\":\"browser_login\",\"origin\":\"http://example.com\"}",
        out _),
    "schema 2 rejects insecure login origins",
    failures);
True(
    DesktopComputerRequest.TryParse(
        "{\"schema\":2,\"requestId\":\"r-forget\",\"type\":\"browser_forget_credentials\",\"origin\":\"https://example.com\"}",
        out _),
    "schema 2 admits origin-bound vault removal",
    failures);
const string credentialRequestId = "0123456789abcdef0123456789abcdef";
const string credentialOrigin = "https://example.com";
var credentialResponseJson = "{\"kind\":\"computer-credential-response\",\"requestId\":\"0123456789abcdef0123456789abcdef\",\"origin\":\"https://example.com\",\"account\":\"unit-user\",\"secret\":\"synthetic-login-secret\",\"remember\":true}";
True(
    DesktopCredentialPromptProtocol.TryParseReply(credentialResponseJson, out var credentialResponse),
    "native credential response parses",
    failures);
True(credentialResponse.Secret == "synthetic-login-secret", "native response keeps the credential only in its private value", failures);
True(credentialResponse.Remember, "native credential response preserves the explicit remember choice", failures);
True(
    DesktopCredentialPromptProtocol.MatchesRequest(credentialRequestId, credentialOrigin, credentialResponse),
    "native response matches its active request and origin",
    failures);
False(
    DesktopCredentialPromptProtocol.MatchesRequest("ffffffffffffffffffffffffffffffff", credentialOrigin, credentialResponse),
    "native response cannot satisfy another request",
    failures);
False(
    DesktopCredentialPromptProtocol.TryParseReply(
        credentialResponseJson.Replace("https://example.com", "http://example.com", StringComparison.Ordinal),
        out _),
    "native credential response rejects non-HTTPS origins",
    failures);
False(
    DesktopCredentialPromptProtocol.TryParseReply(
        credentialResponseJson.Replace("\"remember\":true}", "\"remember\":true,\"extra\":\"value\"}", StringComparison.Ordinal),
        out _),
    "native credential response rejects unknown fields",
    failures);
False(
    DesktopCredentialPromptProtocol.TryParseReply(
        credentialResponseJson.Replace("\"requestId\":\"0123456789abcdef0123456789abcdef\",", "\"requestId\":\"0123456789abcdef0123456789abcdef\",\"requestId\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",", StringComparison.Ordinal),
        out _),
    "native credential response rejects duplicate properties",
    failures);
True(
    DesktopCredentialPromptProtocol.TryParseReply(
        "{\"kind\":\"computer-credential-cancelled\",\"requestId\":\"0123456789abcdef0123456789abcdef\",\"origin\":\"https://example.com\"}",
        out var credentialCancellation),
    "native credential cancellation parses",
    failures);
True(credentialCancellation.Cancelled, "native credential cancellation carries no values", failures);
False(
    DesktopCredentialPromptProtocol.IsTrustedShellMessageSource(
        "http://127.0.0.1:3080/chat",
        "http://127.0.0.1:3080/",
        new Uri("http://127.0.0.1:3080/")),
    "native credential response rejects a stale shell page",
    failures);
True(
    DesktopCredentialPromptProtocol.IsTrustedShellMessageSource(
        "http://127.0.0.1:3080/chat",
        "http://127.0.0.1:3080/chat",
        new Uri("http://127.0.0.1:3080/")),
    "native credential response accepts the current trusted shell page",
    failures);
False(
    DesktopComputerRequest.TryParse(
        "{\"schema\":2,\"requestId\":\"r2\",\"type\":\"click\",\"x\":12,\"y\":34,\"account\":\"secret-user\"}",
        out _),
    "schema 2 rejects credential properties",
    failures);
False(
    DesktopComputerRequest.TryParse(
        "{\"schema\":2,\"requestId\":\"r2-secret\",\"type\":\"click\",\"x\":12,\"y\":34,\"secret\":\"synthetic-login-secret\"}",
        out _),
    "schema 2 rejects secret properties",
    failures);
False(
    DesktopComputerRequest.TryParse(
        "{\"schema\":2,\"requestId\":\"r3\",\"type\":\"click\",\"x\":12,\"y\":34,\"button\":\"side\"}",
        out _),
    "schema 2 rejects unsupported mouse buttons",
    failures);
True(DesktopComputerProtocol.MatchesReply("r1", "r1"), "reply matches request id", failures);
False(DesktopComputerProtocol.MatchesReply("r1", "r2"), "reply cannot cross request ids", failures);
False(DesktopBrowserControlServer.IsAllowedClient(999, 123), "unrelated client PID is rejected", failures);
if (OperatingSystem.IsWindows())
    True(
        DesktopBrowserControlServer.IsAllowedClient(Environment.ProcessId, Environment.ProcessId),
        "the owning runtime PID is accepted",
        failures);
if (OperatingSystem.IsWindows())
{
    var residentWindows = DesktopComputerDriver.Execute(new DesktopComputerRequest(2, "driver-test", "windows"));
    True(residentWindows.Details is not null, "resident Win32 driver enumerates desktop windows", failures);
}

// The model/runtime must control the embedded WebView through a direct current-user named pipe.
// This prevents browser_open from falling back to global Ctrl+L/type/Enter input.
var controlDescriptorPath = Path.Combine(Path.GetTempPath(), $"phoenix-desktop-control-{Guid.NewGuid():N}.json");
BrowserCommand? receivedControlCommand = null;
using (var control = new DesktopBrowserControlServer(
    command =>
    {
        receivedControlCommand = command;
        return Task.FromResult<string?>(null);
    },
    controlDescriptorPath))
{
    var descriptorJson = await File.ReadAllTextAsync(controlDescriptorPath);
    True(
        DesktopBrowserControlDescriptor.TryParse(descriptorJson, out var descriptor),
        "desktop control descriptor parses",
        failures);
    Equal(control.PipeName, descriptor.PipeName, "desktop control descriptor names live pipe", failures);
    EqualInt(2, descriptor.Schema, "desktop control descriptor schema", failures);

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

    await writer.WriteLineAsync("{\"schema\":2,\"requestId\":\"resident-1\",\"type\":\"browser_inspect\"}");
    var residentReply = await reader.ReadLineAsync();
    True(residentReply?.Contains("\"schema\":2", StringComparison.Ordinal) == true,
        "resident schema 2 reply is versioned",
        failures);
    True(residentReply?.Contains("\"requestId\":\"resident-1\"", StringComparison.Ordinal) == true,
        "resident reply preserves request id",
        failures);

    await writer.WriteLineAsync("{\"schema\":2,\"requestId\":\"resident-2\",\"type\":\"browser_close\"}");
    var secondResidentReply = await reader.ReadLineAsync();
    True(secondResidentReply?.Contains("\"requestId\":\"resident-2\"", StringComparison.Ordinal) == true,
        "resident pipe accepts a second serialized request",
        failures);

    var previouslyReceived = receivedControlCommand?.Type;
    await writer.WriteLineAsync("{\"type\":\"phoenix.browser.login\",\"origin\":\"https://example.com/login\",\"account\":\"unit-user\",\"secret\":\"synthetic-login-secret\"}");
    var legacyLoginReply = await reader.ReadLineAsync();
    True(legacyLoginReply?.Contains("\"ok\":false", StringComparison.Ordinal) == true,
        "legacy pipe rejects inline credential login",
        failures);
    Equal(previouslyReceived, receivedControlCommand?.Type, "rejected legacy login is never dispatched", failures);
}
False(File.Exists(controlDescriptorPath), "desktop control descriptor removed on dispose", failures);

True(BrowserLayout.StartCollapsed, "embedded browser starts collapsed", failures);
EqualInt(440, BrowserLayout.PreferredBrowserWidth(1100), "small window targets a 60/40 chat/browser split", failures);
EqualInt(576, BrowserLayout.PreferredBrowserWidth(1440), "normal window targets a 60/40 chat/browser split", failures);
EqualInt(960, BrowserLayout.PreferredBrowserWidth(2400), "wide window preserves the 60/40 chat/browser split", failures);

// Desktop startup must be visible before the managed runtime is ready. This is the regression
// contract for the installed EXE appearing to do nothing on first launch.
True(DesktopStartupContract.ShowWindowBeforeRuntimeReady, "desktop window is shown before runtime readiness", failures);
True(DesktopStartupContract.SecondLaunchSignalsExistingWindow, "second launch signals existing window", failures);
True(DesktopStartupContract.ReentryCollapsesBrowser, "re-entering Phoenix returns to a chat-first surface", failures);
True(DesktopStartupContract.ReentryRetriesFailedStartup, "re-entering Phoenix retries a completed failed startup", failures);
True(DesktopStartupContract.EmbeddedBrowserStartsLazy, "embedded browser does not delay chat startup", failures);
True(DesktopStartupContract.UserCloseHidesToTray, "user close hides Phoenix to tray instead of stopping runtime", failures);
Equal("Iniciando Phoenix…", DesktopStartupContract.InitialStatus, "startup status is explicit", failures);
EqualInt(2, DesktopRuntimeLaunchContract.ReadyConsecutiveSamples, "desktop waits for a stable backend confirmation", failures);
EqualInt(250, DesktopRuntimeLaunchContract.ReadySampleDelayMilliseconds, "stable backend confirmation avoids artificial startup delay", failures);
EqualInt(3, DesktopRuntimeLaunchContract.MaxUnexpectedBackendRestarts, "desktop stops waiting after a short backend crash loop", failures);
EqualInt(12, DesktopRuntimeLaunchContract.ManagedBootstrapTimeoutMinutes, "managed bootstrap has a bounded timeout", failures);
True(DesktopNavigationRecovery.IsTransient("ConnectionAborted"), "connection-aborted WebView startup failure is retried", failures);
True(DesktopNavigationRecovery.IsTransient("ConnectionReset"), "connection-reset WebView startup failure is retried", failures);
True(DesktopNavigationRecovery.IsTransient("Unknown"), "WebView unknown startup race is retried within the bounded budget", failures);
False(DesktopNavigationRecovery.IsTransient("CertificateIsInvalid"), "non-transient WebView failures are not retried blindly", failures);
True(
    DesktopPhoenixIdentity.LooksLikePhoenixHtml("<!doctype html><html><head><title>PHOENIX HARDNESS</title></head><body><div id=\"root\"></div></body></html>"),
    "Phoenix readiness accepts the real application shell",
    failures);
False(
    DesktopPhoenixIdentity.LooksLikePhoenixHtml("<html><body>unrelated server</body></html>"),
    "Phoenix readiness rejects an unrelated listener on port 3080",
    failures);
True(DesktopPhoenixLoopback.IsPhoenixOrigin(new Uri("http://127.0.0.1:3080/chat"), new Uri("http://127.0.0.1:3080/")), "IPv4 loopback is a trusted Phoenix origin", failures);
True(DesktopPhoenixLoopback.IsPhoenixOrigin(new Uri("http://localhost:3080/chat"), new Uri("http://127.0.0.1:3080/")), "localhost redirect remains inside Phoenix", failures);
True(DesktopPhoenixLoopback.IsPhoenixOrigin(new Uri("http://[::1]:3080/chat"), new Uri("http://127.0.0.1:3080/")), "IPv6 loopback redirect remains inside Phoenix", failures);
False(DesktopPhoenixLoopback.IsPhoenixOrigin(new Uri("http://example.com:3080/chat"), new Uri("http://127.0.0.1:3080/")), "external host on Phoenix port is rejected", failures);
Equal("127.0.0.1", DesktopPhoenixLoopback.NavigationBase(new Uri("http://127.0.0.1:3080/"), 0).Host, "first WebView navigation uses explicit IPv4 loopback", failures);
Equal("localhost", DesktopPhoenixLoopback.NavigationBase(new Uri("http://127.0.0.1:3080/"), 3).Host, "repeated WebView failure alternates through localhost", failures);
Equal("--no-proxy-server", DesktopPhoenixLoopback.ShellBrowserArguments, "Phoenix shell bypasses system proxies for loopback traffic", failures);
True(DesktopPhoenixLoopback.ShellProfilePath(@"C:\Phoenix").EndsWith(@"webview\shell-v2", StringComparison.OrdinalIgnoreCase), "Phoenix shell uses a fresh recovery profile generation", failures);
True(DesktopNavigationRecovery.RetryDelayMilliseconds(1) < DesktopNavigationRecovery.RetryDelayMilliseconds(4), "WebView retry backoff increases", failures);

var toolchainEntries = DesktopBundledToolchain.CandidatePathEntries(@"C:\Program Files\Phoenix");
True(toolchainEntries.Any(path => path.EndsWith(@"runtime-tools\node", StringComparison.OrdinalIgnoreCase)), "bundled Node path is declared", failures);
True(toolchainEntries.Any(path => path.EndsWith(@"runtime-tools\git\cmd", StringComparison.OrdinalIgnoreCase)), "bundled Git path is declared", failures);
Equal(@"C:\Program Files\Phoenix\runtime-tools", DesktopBundledToolchain.ToolchainRoot(@"C:\Program Files\Phoenix"), "toolchain root is app-local", failures);
Equal(@"C:\Program Files\Phoenix\runtime-tools\node\node.exe", DesktopBundledToolchain.NodeExecutable(@"C:\Program Files\Phoenix"), "bundled Node executable is app-local", failures);

var runtimeLaunch = DesktopRuntimeLaunchContract.CreateOwnedRuntimeStartInfo(
    @"C:\Program Files\Phoenix",
    @"C:\Phoenix Runtime",
    @"C:\Phoenix\desktop-control.json");
Equal(@"C:\Program Files\Phoenix\runtime-tools\node\node.exe", runtimeLaunch.FileName, "desktop runtime uses bundled Node directly", failures);
True(runtimeLaunch.CreateNoWindow, "runtime backend stays out of the chat surface", failures);
False(runtimeLaunch.UseShellExecute, "Node runtime is directly supervised", failures);
True(runtimeLaunch.ArgumentList.Any(value => value.EndsWith(@"scripts\phoenix-windows-supervisor.mjs", StringComparison.OrdinalIgnoreCase)), "Node invokes the Phoenix supervisor directly", failures);
False(runtimeLaunch.ArgumentList.Any(value => value.Contains("phoenix-windows.cmd", StringComparison.OrdinalIgnoreCase)), "normal desktop launch bypasses cmd wrapper", failures);
False(runtimeLaunch.ArgumentList.Any(value => value.Contains("powershell", StringComparison.OrdinalIgnoreCase)), "normal desktop launch has no PowerShell hop", failures);
EqualInt(3080, DesktopRuntimeLaunchContract.DesktopPort, "desktop shell uses the normal Phoenix port", failures);
False(runtimeLaunch.ArgumentList.Any(value => value.Contains("--port 3081", StringComparison.Ordinal)), "desktop launcher never forces the old private 3081 port", failures);
True(runtimeLaunch.ArgumentList.Any(value => value.Contains("--no-open", StringComparison.Ordinal)), "desktop runtime never opens an external browser", failures);
Equal("1", runtimeLaunch.Environment["PHOENIX_DESKTOP_MANAGED"], "desktop managed environment is preserved", failures);
Equal(@"C:\Phoenix\desktop-control.json", runtimeLaunch.Environment["PHOENIX_DESKTOP_CONTROL_DESCRIPTOR"], "desktop control descriptor reaches supervisor", failures);
Equal("desktop", runtimeLaunch.Environment["PHOENIX_SURFACE"], "runtime knows it is hosted by the desktop shell", failures);
Equal("1", runtimeLaunch.Environment["PHOENIX_DESKTOP_SHELL"], "desktop shell marker reaches runtime", failures);
Equal("true", runtimeLaunch.Environment["PHOENIX_BROWSER_AUTOSTART"], "desktop automation browser may start on demand", failures);
Equal("chrome", runtimeLaunch.Environment["PHOENIX_BROWSER_PREFERRED_ENGINE"], "desktop prefers Chrome automation", failures);
Equal("0", runtimeLaunch.Environment["COREPACK_ENABLE_DOWNLOAD_PROMPT"], "hidden first-run bootstrap cannot block on an invisible Corepack prompt", failures);
EqualInt(300, DesktopRuntimeLaunchContract.SourceStartupWaitSeconds, "source bootstrap gets enough time to install/build on first run", failures);
Equal("0", runtimeLaunch.Environment["PHOENIX_DESKTOP_CONSOLE"], "normal users get a hidden runtime console", failures);
True(runtimeLaunch.CreateNoWindow, "normal runtime creates no console window", failures);
True(runtimeLaunch.RedirectStandardOutput, "hidden runtime stdout is captured to desktop log", failures);
True(runtimeLaunch.RedirectStandardError, "hidden runtime stderr is captured to desktop log", failures);

var developerLaunch = DesktopRuntimeLaunchContract.CreateOwnedRuntimeStartInfo(
    @"C:\Program Files\Phoenix",
    @"C:\Phoenix Runtime",
    @"C:\Phoenix\desktop-control.json",
    managedRuntime: true,
    showDeveloperConsole: true);
Equal("1", developerLaunch.Environment["PHOENIX_DESKTOP_CONSOLE"], "developer mode exposes runtime console", failures);
False(developerLaunch.CreateNoWindow, "developer mode allows the runtime console", failures);
False(developerLaunch.RedirectStandardOutput, "developer stdout stays attached to visible console", failures);
False(developerLaunch.RedirectStandardError, "developer stderr stays attached to visible console", failures);

var sourceLaunch = DesktopRuntimeLaunchContract.CreateOwnedRuntimeStartInfo(
    @"C:\Program Files\Phoenix",
    @"C:\Working Phoenix",
    @"C:\Phoenix\desktop-control.json",
    managedRuntime: false);
False(sourceLaunch.Environment.ContainsKey("PHOENIX_DESKTOP_MANAGED"), "source checkout is not mislabeled as desktop-managed", failures);
True(sourceLaunch.FileName.EndsWith("powershell.exe", StringComparison.OrdinalIgnoreCase), "source checkout is launched through PowerShell by the EXE", failures);
Equal(@"C:\Working Phoenix", sourceLaunch.WorkingDirectory, "PowerShell starts in the Phoenix checkout directory", failures);
True(sourceLaunch.ArgumentList.Any(value => value.Contains("pnpm phoenix -- --no-open", StringComparison.OrdinalIgnoreCase)), "source checkout runs pnpm phoenix automatically", failures);
True(sourceLaunch.CreateNoWindow, "normal source startup keeps PowerShell hidden", failures);

True(DesktopRuntimeLaunchContract.LooksLikePhoenixProcessCommandLine(@"node scripts\phoenix-windows-supervisor.mjs"), "supervisor listener is recognized as Phoenix", failures);
True(DesktopRuntimeLaunchContract.LooksLikePhoenixProcessCommandLine(@"node C:\Users\me\Phoenix\phoenix-harnes\apps\cli\lib\bin.js web"), "source checkout listener is recognized as Phoenix", failures);
True(DesktopRuntimeLaunchContract.LooksLikePhoenixProcessCommandLine(@"powershell -Command corepack pnpm phoenix -- --no-open"), "PowerShell pnpm Phoenix listener is recognized", failures);
False(DesktopRuntimeLaunchContract.LooksLikePhoenixProcessCommandLine(@"python -m http.server 3080"), "unrelated local HTTP listener is rejected", failures);

var consolePrefRoot = Path.Combine(Path.GetTempPath(), $"phoenix-console-test-{Guid.NewGuid():N}");
var previousConsoleEnv = Environment.GetEnvironmentVariable("PHOENIX_DESKTOP_CONSOLE");
try
{
    Environment.SetEnvironmentVariable("PHOENIX_DESKTOP_CONSOLE", null);
    False(DesktopDeveloperConsole.Requested(consolePrefRoot, Array.Empty<string>()), "developer console defaults off", failures);
    True(DesktopDeveloperConsole.Requested(consolePrefRoot, new[] { "--developer-console" }), "developer console CLI switch enables it", failures);
    DesktopDeveloperConsole.SetEnabled(consolePrefRoot, true);
    True(DesktopDeveloperConsole.Requested(consolePrefRoot, Array.Empty<string>()), "developer console persisted preference enables it", failures);
    DesktopDeveloperConsole.SetEnabled(consolePrefRoot, false);
    False(DesktopDeveloperConsole.Requested(consolePrefRoot, Array.Empty<string>()), "developer console preference can be disabled", failures);
}
finally
{
    Environment.SetEnvironmentVariable("PHOENIX_DESKTOP_CONSOLE", previousConsoleEnv);
    if (Directory.Exists(consolePrefRoot))
        Directory.Delete(consolePrefRoot, recursive: true);
}

var sourceTestRoot = Path.Combine(Path.GetTempPath(), $"phoenix-source-test-{Guid.NewGuid():N}");
var sourceInstallRoot = Path.Combine(Path.GetTempPath(), $"phoenix-install-test-{Guid.NewGuid():N}");
var previousSourceRoot = Environment.GetEnvironmentVariable("PHOENIX_SOURCE_ROOT");
try
{
    Directory.CreateDirectory(Path.Combine(sourceTestRoot, "apps", "cli"));
    Directory.CreateDirectory(Path.Combine(sourceTestRoot, "scripts"));
    File.WriteAllText(Path.Combine(sourceTestRoot, "package.json"), "{}");
    File.WriteAllText(Path.Combine(sourceTestRoot, "phoenix-windows.cmd"), "@echo off");
    File.WriteAllText(Path.Combine(sourceTestRoot, "scripts", "phoenix-windows-supervisor.mjs"), "// supervisor");
    True(DesktopSourceCheckout.IsRunnable(sourceTestRoot), "bootstrappable Phoenix source is recognized without node_modules or .git", failures);
    Environment.SetEnvironmentVariable("PHOENIX_SOURCE_ROOT", null);
    False(DesktopSourceCheckout.ShouldUseSourceCheckout(developerConsoleVisible: false), "normal installed desktop does not auto-boot a discovered source checkout", failures);
    False(DesktopSourceCheckout.ShouldUseSourceCheckout(developerConsoleVisible: true), "developer console does not switch the installed EXE into source mode", failures);

    // Explicit/configured source roots are candidates, but discovery alone must not persist
    // them as the trusted backend until the runtime stability handshake succeeds.
    Environment.SetEnvironmentVariable("PHOENIX_SOURCE_ROOT", sourceTestRoot);
    True(DesktopSourceCheckout.ShouldUseSourceCheckout(developerConsoleVisible: false), "PHOENIX_SOURCE_ROOT explicitly enables source mode", failures);
    Equal(Path.GetFullPath(sourceTestRoot), DesktopSourceCheckout.Resolve(sourceInstallRoot), "configured bootstrappable source resolves before managed bootstrap", failures);
    False(File.Exists(DesktopSourceCheckout.VerifiedPointerPath(sourceInstallRoot)), "unverified source is not persisted as the backend of record", failures);

    DesktopSourceCheckout.RememberVerified(sourceInstallRoot, sourceTestRoot);
    Equal(Path.GetFullPath(sourceTestRoot), File.ReadAllText(DesktopSourceCheckout.VerifiedPointerPath(sourceInstallRoot)).Trim(), "verified backend root is persisted", failures);
    Equal(Path.GetFullPath(sourceTestRoot), DesktopSourceCheckout.Resolve(sourceInstallRoot), "verified backend root resolves first on later launches", failures);

    DesktopSourceCheckout.ForgetVerified(sourceInstallRoot);
    False(File.Exists(DesktopSourceCheckout.VerifiedPointerPath(sourceInstallRoot)), "failed source fallback clears verified backend pointer", failures);
    False(File.Exists(DesktopSourceCheckout.LegacyPointerPath(sourceInstallRoot)), "failed source fallback clears legacy backend pointer", failures);
    DesktopSourceCheckout.RememberVerified(sourceInstallRoot, sourceTestRoot);

    var conventionalRoots = DesktopSourceCheckout.ConventionalRoots(@"C:\Users\arisn");
    True(
        conventionalRoots.Any(path => path.EndsWith(@"OneDrive\Documentos\ChatGPT\Fenix-evolution\phoenix-harnes\phoenix-harnes", StringComparison.OrdinalIgnoreCase)),
        "desktop discovers the nested Fenix-evolution checkout used by local Phoenix installs",
        failures);

    DesktopInstallationState.RememberApplicationRoot(sourceInstallRoot, @"C:\Program Files\Phoenix");
    Equal(@"C:\Program Files\Phoenix", File.ReadAllText(DesktopInstallationState.AppRootPath(sourceInstallRoot)).Trim(), "installed application root is persisted separately from backend root", failures);

    Directory.CreateDirectory(Path.Combine(sourceTestRoot, ".git"));
    True(DesktopSourceCheckout.IsRunnable(sourceTestRoot), "normal Git checkout remains recognized", failures);

    Directory.Delete(Path.Combine(sourceTestRoot, ".git"), recursive: true);
    File.WriteAllText(Path.Combine(sourceTestRoot, ".git"), "gitdir: C:\\worktrees\\phoenix");
    True(DesktopSourceCheckout.IsRunnable(sourceTestRoot), "Git worktree metadata does not affect bootability", failures);

    File.Delete(Path.Combine(sourceTestRoot, "scripts", "phoenix-windows-supervisor.mjs"));
    False(DesktopSourceCheckout.IsRunnable(sourceTestRoot), "folder without the Phoenix supervisor is rejected", failures);
}
finally
{
    Environment.SetEnvironmentVariable("PHOENIX_SOURCE_ROOT", previousSourceRoot);
    if (Directory.Exists(sourceTestRoot))
        Directory.Delete(sourceTestRoot, recursive: true);
    if (Directory.Exists(sourceInstallRoot))
        Directory.Delete(sourceInstallRoot, recursive: true);
}

// A managed runtime is healthy only after install/build completed. Old desktop builds could leave
// an empty marker behind before those steps completed; that state must never be accepted as ready.
True(ManagedRuntimeMarker.IsReadyContent("schema=1\nstate=ready\ninstalledAt=2026-09-17T00:00:00Z"), "completed runtime marker accepted", failures);
False(ManagedRuntimeMarker.IsReadyContent(""), "empty legacy marker rejected", failures);
False(ManagedRuntimeMarker.IsReadyContent("schema=1\ninstalledAt=2026-09-17T00:00:00Z"), "marker without ready state rejected", failures);
True(ManagedRuntimeMarker.RequiresCleanBootstrap(ManagedRuntimeState.Recoverable), "recoverable managed runtime is rebuilt cleanly instead of resumed", failures);
True(ManagedRuntimeMarker.RequiresCleanBootstrap(ManagedRuntimeState.Unmanaged), "unmanaged desktop runtime is rebuilt cleanly", failures);
False(ManagedRuntimeMarker.RequiresCleanBootstrap(ManagedRuntimeState.Missing), "missing runtime proceeds directly to clean bootstrap", failures);
False(ManagedRuntimeMarker.RequiresCleanBootstrap(ManagedRuntimeState.Ready), "verified runtime is never rebuilt during normal startup", failures);

// Runtime-seed installation is intentionally a pure worker/pre-warm operation. A tiny synthetic
// seed proves the atomic installer without requiring the full production archive in this test.
var seedAppRoot = Path.Combine(Path.GetTempPath(), $"phoenix-seed-app-{Guid.NewGuid():N}");
var seedSourceRoot = Path.Combine(Path.GetTempPath(), $"phoenix-seed-source-{Guid.NewGuid():N}");
var seedRuntimeRoot = Path.Combine(Path.GetTempPath(), $"phoenix-seed-runtime-{Guid.NewGuid():N}");
try
{
    Directory.CreateDirectory(seedAppRoot);
    Directory.CreateDirectory(Path.Combine(seedSourceRoot, ".git"));
    File.WriteAllText(Path.Combine(seedSourceRoot, ".git", "HEAD"), "ref: refs/heads/stable\n");
    File.WriteAllText(
        Path.Combine(seedSourceRoot, ManagedRuntimeMarker.ReadyMarkerName),
        "schema=1\nstate=ready\ninstalledAt=2026-09-20T00:00:00Z\n");
    File.WriteAllText(Path.Combine(seedSourceRoot, "payload.txt"), "phoenix-runtime-seed");
    ZipFile.CreateFromDirectory(
        seedSourceRoot,
        DesktopRuntimeSeedInstaller.ArchivePath(seedAppRoot),
        CompressionLevel.Fastest,
        includeBaseDirectory: false);

    True(
        DesktopRuntimeSeedInstaller.EnsureInstalled(seedAppRoot, seedRuntimeRoot),
        "runtime seed installer prepares a missing managed runtime",
        failures);
    True(
        File.Exists(Path.Combine(seedRuntimeRoot, "payload.txt")),
        "runtime seed installer materializes the production payload",
        failures);
    True(
        ManagedRuntimeMarker.Inspect(seedRuntimeRoot) == ManagedRuntimeState.Ready,
        "runtime seed installer leaves a verified ready runtime",
        failures);
}
finally
{
    foreach (var path in new[] { seedAppRoot, seedSourceRoot, seedRuntimeRoot })
    {
        if (Directory.Exists(path))
            Directory.Delete(path, recursive: true);
    }
}

if (failures.Count == 0)
{
    Console.WriteLine("Embedded browser and desktop startup contract checks passed.");
    return 0;
}

Console.Error.WriteLine($"Embedded browser and desktop startup contract checks failed: {failures.Count}");
foreach (var failure in failures) Console.Error.WriteLine($" - {failure}");
return 1;
