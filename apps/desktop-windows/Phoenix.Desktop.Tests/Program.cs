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

False(BrowserCommand.TryParse("{not-json}", out _), "malformed json rejected", failures);
False(BrowserCommand.TryParse("{\"type\":\"phoenix.browser.open\",\"url\":\"javascript:alert(1)\"}", out _), "unsafe open command rejected", failures);
False(BrowserCommand.TryParse("{\"type\":\"unknown\"}", out _), "unknown command rejected", failures);

// Desktop startup must be visible before the managed runtime is ready. This is the regression
// contract for the installed EXE appearing to do nothing on first launch.
True(DesktopStartupContract.ShowWindowBeforeRuntimeReady, "desktop window is shown before runtime readiness", failures);
True(DesktopStartupContract.SecondLaunchSignalsExistingWindow, "second launch signals existing window", failures);
Equal("Preparando Phoenix…", DesktopStartupContract.InitialStatus, "startup status is explicit", failures);

if (failures.Count == 0)
{
    Console.WriteLine("Embedded browser and desktop startup contract checks passed.");
    return 0;
}

Console.Error.WriteLine($"Embedded browser and desktop startup contract checks failed: {failures.Count}");
foreach (var failure in failures) Console.Error.WriteLine($" - {failure}");
return 1;
