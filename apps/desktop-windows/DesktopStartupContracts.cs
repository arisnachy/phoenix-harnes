using System.Diagnostics;

namespace Phoenix.Desktop;

internal static class DesktopStartupContract
{
    internal const bool ShowWindowBeforeRuntimeReady = true;
    internal const bool SecondLaunchSignalsExistingWindow = true;
    internal const bool ReentryCollapsesBrowser = true;
    internal const bool ReentryRetriesFailedStartup = true;
    internal const bool EmbeddedBrowserStartsLazy = true;
    internal const bool UserCloseHidesToTray = true;
    internal const string InitialStatus = "Iniciando Phoenix…";

    internal static string? ResolveSourceRoot(string stateRoot, bool sourceModeRequested)
    {
        if (!sourceModeRequested)
            return null;

        var configured = Environment.GetEnvironmentVariable("PHOENIX_SOURCE_ROOT");
        return DesktopSourceCheckout.IsRunnable(configured)
            ? DesktopSourceCheckout.Resolve(stateRoot, includeConventional: false)
            : null;
    }
}

internal readonly record struct DesktopRuntimeListenerIdentity(
    int ProcessId,
    long CreationTimeUtcTicks);

internal static class DesktopRuntimeLaunchContract
{
    internal const int DesktopPort = 3080;
    internal const int SourceStartupWaitSeconds = 300;
    internal const int ManagedStartupWaitSeconds = 120;
    internal const int ReadyConsecutiveSamples = 2;
    internal const int ReadySampleDelayMilliseconds = 250;
    internal const int MaxUnexpectedBackendRestarts = 3;
    internal const int ManagedBootstrapTimeoutMinutes = 12;

    internal static ProcessStartInfo CreateOwnedRuntimeStartInfo(
        string applicationBaseDirectory,
        string runtimeRoot,
        string controlDescriptorPath,
        bool managedRuntime = true,
        bool showDeveloperConsole = false)
    {
        var supervisor = Path.Combine(runtimeRoot, "scripts", "phoenix-windows-supervisor.mjs");
        var startInfo = new ProcessStartInfo
        {
            WorkingDirectory = runtimeRoot,
            UseShellExecute = false,
            CreateNoWindow = !showDeveloperConsole,
            RedirectStandardOutput = !showDeveloperConsole,
            RedirectStandardError = !showDeveloperConsole,
            WindowStyle = showDeveloperConsole ? ProcessWindowStyle.Normal : ProcessWindowStyle.Hidden,
        };

        if (managedRuntime)
        {
            // Production startup is deliberately independent from PowerShell, cmd.exe, Corepack,
            // pnpm and tsx. The native shell supervises the bundled Node runtime directly.
            startInfo.FileName = DesktopBundledToolchain.NodeExecutable(applicationBaseDirectory);
            startInfo.ArgumentList.Add(supervisor);
            startInfo.ArgumentList.Add("--no-open");
        }
        else
        {
            // When a real Phoenix source checkout is present, the desktop EXE owns the exact
            // startup sequence the user would otherwise run manually: open PowerShell in the
            // checkout and execute "pnpm phoenix -- --no-open". The shell stays hidden for normal
            // users and can be shown through the developer-console preference.
            startInfo.FileName = "powershell.exe";
            startInfo.ArgumentList.Add("-NoLogo");
            startInfo.ArgumentList.Add("-NoProfile");
            startInfo.ArgumentList.Add("-ExecutionPolicy");
            startInfo.ArgumentList.Add("Bypass");
            if (!showDeveloperConsole)
                startInfo.ArgumentList.Add("-NonInteractive");
            startInfo.ArgumentList.Add("-Command");
            startInfo.ArgumentList.Add("$ErrorActionPreference='Stop'; pnpm phoenix -- --no-open");
        }

        if (managedRuntime)
            startInfo.Environment["PHOENIX_DESKTOP_MANAGED"] = "1";
        else
            startInfo.Environment.Remove("PHOENIX_DESKTOP_MANAGED");
        startInfo.Environment["PHOENIX_DESKTOP_CONTROL_DESCRIPTOR"] = controlDescriptorPath;
        startInfo.Environment["PHOENIX_SURFACE"] = "desktop";
        startInfo.Environment["PHOENIX_DESKTOP_SHELL"] = "1";
        startInfo.Environment["PHOENIX_DESKTOP_CONSOLE"] = showDeveloperConsole ? "1" : "0";
        startInfo.Environment["PHOENIX_BROWSER_AUTOSTART"] = "true";
        startInfo.Environment["PHOENIX_BROWSER_PREFERRED_ENGINE"] = "chrome";
        // Hidden first-run launches must never wait for an invisible Corepack confirmation.
        startInfo.Environment["COREPACK_ENABLE_DOWNLOAD_PROMPT"] = "0";
        return startInfo;
    }

    internal static bool LooksLikePhoenixProcessCommandLine(string? commandLine)
    {
        if (string.IsNullOrWhiteSpace(commandLine)) return false;
        return commandLine.Contains("phoenix-windows-supervisor.mjs", StringComparison.OrdinalIgnoreCase)
            || commandLine.Contains("phoenix-windows.cmd", StringComparison.OrdinalIgnoreCase)
            || commandLine.Contains(@"runtime-app\lib\bin.js", StringComparison.OrdinalIgnoreCase)
            || commandLine.Contains("phoenix-harnes", StringComparison.OrdinalIgnoreCase)
            || commandLine.Contains(@"apps\cli\", StringComparison.OrdinalIgnoreCase)
            || commandLine.Contains("apps/cli/", StringComparison.OrdinalIgnoreCase)
            || commandLine.Contains("pnpm phoenix", StringComparison.OrdinalIgnoreCase)
            || commandLine.Contains(@"\Phoenix\runtime", StringComparison.OrdinalIgnoreCase);
    }

    internal static bool CanMarkReady(bool supervisorExited, int consecutiveReady) =>
        !supervisorExited && consecutiveReady >= ReadyConsecutiveSamples;

    internal static bool HasStableListenerIdentity(
        int firstProcessId,
        long firstCreationTimeUtcTicks,
        int secondProcessId,
        long secondCreationTimeUtcTicks) =>
        firstProcessId > 0
        && secondProcessId == firstProcessId
        && firstCreationTimeUtcTicks > 0
        && secondCreationTimeUtcTicks == firstCreationTimeUtcTicks;

    // This method classifies a command line; adoption also requires endpoint, PID, and liveness checks.
    internal static bool CanAdoptListener(string? commandLine) =>
        LooksLikePhoenixProcessCommandLine(commandLine);
}



internal static class DesktopDeveloperConsole
{
    internal const string FlagFileName = "developer-console.enabled";

    internal static string FlagPath(string installRoot) => Path.Combine(installRoot, FlagFileName);

    internal static bool Requested(string installRoot, IReadOnlyCollection<string> args)
    {
        if (args.Any(arg => string.Equals(arg, "--developer-console", StringComparison.OrdinalIgnoreCase)))
            return true;

        var env = Environment.GetEnvironmentVariable("PHOENIX_DESKTOP_CONSOLE")?.Trim();
        if (string.Equals(env, "1", StringComparison.OrdinalIgnoreCase)
            || string.Equals(env, "true", StringComparison.OrdinalIgnoreCase)
            || string.Equals(env, "yes", StringComparison.OrdinalIgnoreCase))
            return true;

        return File.Exists(FlagPath(installRoot));
    }

    internal static void SetEnabled(string installRoot, bool enabled)
    {
        Directory.CreateDirectory(installRoot);
        var path = FlagPath(installRoot);
        if (enabled)
        {
            File.WriteAllText(path, "enabled\n");
            return;
        }

        try
        {
            File.Delete(path);
        }
        catch (FileNotFoundException)
        {
            // Already disabled.
        }
    }
}

internal static class DesktopInstallationState
{
    internal const string AppRootFileName = "app-root.txt";

    internal static string AppRootPath(string stateRoot) =>
        Path.Combine(stateRoot, AppRootFileName);

    internal static void RememberApplicationRoot(string stateRoot, string applicationRoot)
    {
        try
        {
            Directory.CreateDirectory(stateRoot);
            File.WriteAllText(AppRootPath(stateRoot), Path.GetFullPath(applicationRoot));
        }
        catch
        {
            // The executable already knows its live AppContext path; persistence is recovery metadata.
        }
    }
}

internal static class DesktopSourceCheckout
{
    internal const string VerifiedPointerFileName = "backend-root.txt";
    internal const string LegacyPointerFileName = "source-root.txt";

    internal static string VerifiedPointerPath(string stateRoot) =>
        Path.Combine(stateRoot, VerifiedPointerFileName);

    internal static string LegacyPointerPath(string stateRoot) =>
        Path.Combine(stateRoot, LegacyPointerFileName);

    internal static bool IsRunnable(string? root)
    {
        if (string.IsNullOrWhiteSpace(root)) return false;
        try
        {
            var full = Path.GetFullPath(root);
            // Desktop startup cares whether this folder can boot Phoenix, not whether it is
            // currently a Git checkout. Users may move/copy a known-good checkout or use a
            // worktree/OneDrive location where .git metadata is absent or temporarily offline.
            return Directory.Exists(full)
                && File.Exists(Path.Combine(full, "package.json"))
                && File.Exists(Path.Combine(full, "phoenix-windows.cmd"))
                && File.Exists(Path.Combine(full, "scripts", "phoenix-windows-supervisor.mjs"))
                && Directory.Exists(Path.Combine(full, "apps", "cli"));
        }
        catch
        {
            return false;
        }
    }

    private static string? ReadPointer(string path)
    {
        if (!File.Exists(path)) return null;
        try
        {
            var value = File.ReadAllText(path).Trim();
            return string.IsNullOrWhiteSpace(value) ? null : value;
        }
        catch
        {
            return null;
        }
    }

    internal static bool ShouldUseSourceCheckout(bool developerConsoleVisible)
    {
        // Showing the developer console is only a diagnostics preference. It must never switch
        // the installed product into a source checkout, because that reintroduces cmd/PowerShell
        // bootstrapping and makes normal EXE startup depend on a local repository. Source mode is
        // explicit through PHOENIX_SOURCE_ROOT only.
        _ = developerConsoleVisible;
        return !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("PHOENIX_SOURCE_ROOT"));
    }

    internal static IReadOnlyList<string> CandidateRoots(string stateRoot, bool includeConventional = false)
    {
        var values = new List<string>();
        var configured = Environment.GetEnvironmentVariable("PHOENIX_SOURCE_ROOT");
        if (!string.IsNullOrWhiteSpace(configured))
            values.Add(configured);

        // A backend that successfully completed the desktop stability handshake wins over
        // heuristic path discovery on all later launches.
        var verified = ReadPointer(VerifiedPointerPath(stateRoot));
        if (!string.IsNullOrWhiteSpace(verified))
            values.Add(verified);

        // Keep reading the legacy pointer so upgrades from 1.0.5-1.0.9 retain their hint.
        var legacy = ReadPointer(LegacyPointerPath(stateRoot));
        if (!string.IsNullOrWhiteSpace(legacy))
            values.Add(legacy);

        if (includeConventional)
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (!string.IsNullOrWhiteSpace(home))
                values.AddRange(ConventionalRoots(home));
        }

        return values
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value =>
            {
                try { return Path.GetFullPath(value); }
                catch { return value; }
            })
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    internal static IReadOnlyList<string> ConventionalRoots(string home)
    {
        if (string.IsNullOrWhiteSpace(home)) return Array.Empty<string>();

        var chatRoots = new[]
        {
            Path.Combine(home, "OneDrive", "Documentos", "ChatGPT"),
            Path.Combine(home, "OneDrive", "Documents", "ChatGPT"),
            Path.Combine(home, "Documents", "ChatGPT"),
            Path.Combine(home, "ChatGPT"),
        };

        var values = new List<string>();
        foreach (var chatRoot in chatRoots)
        {
            // Historical Phoenix locations are intentionally explicit and cheap to probe.
            // In particular, Fenix-evolution may contain a repository folder nested one level
            // deeper after a zip/worktree migration: ...\phoenix-harnes\phoenix-harnes.
            values.Add(Path.Combine(chatRoot, "Fenix-evolution", "phoenix-harnes", "phoenix-harnes"));
            values.Add(Path.Combine(chatRoot, "Fenix-evolution", "phoenix-harnes"));
            values.Add(Path.Combine(chatRoot, "Phoenix", "phoenix-harnes"));
            values.Add(Path.Combine(chatRoot, "phoenix-harnes"));
        }

        values.Add(Path.Combine(home, "Phoenix", "phoenix-harnes"));
        return values
            .Select(value =>
            {
                try { return Path.GetFullPath(value); }
                catch { return value; }
            })
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    internal static string? Resolve(string stateRoot, bool includeConventional = false)
    {
        foreach (var candidate in CandidateRoots(stateRoot, includeConventional))
        {
            if (IsRunnable(candidate))
                return candidate;
        }
        return null;
    }

    internal static void RememberVerified(string stateRoot, string root)
    {
        try
        {
            Directory.CreateDirectory(stateRoot);
            var full = Path.GetFullPath(root);
            File.WriteAllText(VerifiedPointerPath(stateRoot), full);
            // Keep the old pointer synchronized for downgrade/backward compatibility.
            File.WriteAllText(LegacyPointerPath(stateRoot), full);
        }
        catch
        {
            // Successful startup remains valid even if persistence is temporarily unavailable.
        }
    }

    internal static bool RememberVerifiedIfReady(string stateRoot, string root, bool startupReady)
    {
        if (!startupReady)
            return false;

        RememberVerified(stateRoot, root);
        return true;
    }

    internal static void ForgetVerified(string stateRoot)
    {
        foreach (var path in new[] { VerifiedPointerPath(stateRoot), LegacyPointerPath(stateRoot) })
        {
            try { File.Delete(path); }
            catch { }
        }
    }
}

internal static class DesktopPhoenixLoopback
{
    internal const string ShellBrowserArguments = "--no-proxy-server";
    internal const string ShellProfileGeneration = "shell-v2";

    internal static string ShellProfilePath(string installRoot) =>
        Path.Combine(installRoot, "webview", ShellProfileGeneration);

    internal static bool IsPhoenixOrigin(Uri target, Uri canonical)
    {
        if (!target.Scheme.Equals(canonical.Scheme, StringComparison.OrdinalIgnoreCase)
            || target.Port != canonical.Port)
            return false;

        return IsLoopbackHost(target.Host);
    }

    internal static bool IsLoopbackHost(string? host)
    {
        if (string.IsNullOrWhiteSpace(host))
            return false;

        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase))
            return true;

        var normalizedHost = host.Trim('[', ']');
        if (System.Net.IPAddress.TryParse(normalizedHost, out var address))
            return System.Net.IPAddress.IsLoopback(address);

        return false;
    }

    internal static Uri NavigationBase(Uri canonical, int retryCount)
    {
        // Start with the explicit IPv4 loopback address. If Chromium reports repeated transient
        // navigation failures, alternate through localhost so Windows/proxy/VPN policies that
        // special-case one spelling cannot strand the desktop shell.
        if (retryCount >= 2 && retryCount % 2 == 1)
        {
            var builder = new UriBuilder(canonical) { Host = "localhost" };
            return builder.Uri;
        }

        return canonical;
    }
}

internal static class DesktopNavigationRecovery
{
    internal const int MaxRetries = 8;

    internal static bool IsTransient(string? webErrorStatus)
    {
        return webErrorStatus is
            "ConnectionAborted" or
            "ConnectionReset" or
            "CannotConnect" or
            "Disconnected" or
            "Timeout" or
            "OperationCanceled" or
            // WebView2 can report Unknown while a loopback navigation is superseded or the
            // renderer reconnects during startup. Treat it as transient, but keep the bounded
            // retry budget so real failures still surface instead of looping forever.
            "Unknown";
    }

    internal static int RetryDelayMilliseconds(int attempt)
    {
        var normalized = Math.Clamp(attempt, 1, MaxRetries);
        return Math.Min(3_500, 500 + (normalized * 350));
    }
}

internal static class DesktopPhoenixIdentity
{
    internal const string HtmlMarker = "PHOENIX HARDNESS";

    internal static bool LooksLikePhoenixHtml(string? html)
    {
        return !string.IsNullOrWhiteSpace(html)
            && html.Contains(HtmlMarker, StringComparison.OrdinalIgnoreCase)
            && html.Contains("<div id=\"root\">", StringComparison.OrdinalIgnoreCase);
    }
}

internal enum ManagedRuntimeState
{
    Missing,
    Ready,
    Recoverable,
    Unmanaged,
}

internal static class ManagedRuntimeMarker
{
    internal static bool RequiresCleanBootstrap(ManagedRuntimeState state) =>
        state is ManagedRuntimeState.Recoverable or ManagedRuntimeState.Unmanaged;

    internal const string ReadyMarkerName = ".phoenix-managed-install";
    internal const string InstallingMarkerName = ".phoenix-managed-installing";

    internal static ManagedRuntimeState Inspect(string runtimeRoot)
    {
        if (!Directory.Exists(runtimeRoot))
            return ManagedRuntimeState.Missing;

        var readyMarker = Path.Combine(runtimeRoot, ReadyMarkerName);
        var installingMarker = Path.Combine(runtimeRoot, InstallingMarkerName);
        var hasGit = Directory.Exists(Path.Combine(runtimeRoot, ".git"));

        if (File.Exists(readyMarker))
        {
            try
            {
                var content = File.ReadAllText(readyMarker);
                if (IsReadyContent(content) && hasGit)
                    return ManagedRuntimeState.Ready;

                // Old desktop builds created the managed marker before install/build completed.
                // A marker without ready metadata is therefore recoverable, not trustworthy-ready.
                if (hasGit)
                    return ManagedRuntimeState.Recoverable;
            }
            catch
            {
                if (hasGit)
                    return ManagedRuntimeState.Recoverable;
            }
        }

        if (File.Exists(installingMarker) && hasGit)
            return ManagedRuntimeState.Recoverable;

        return ManagedRuntimeState.Unmanaged;
    }

    internal static bool IsReadyContent(string? content)
    {
        if (string.IsNullOrWhiteSpace(content))
            return false;

        return content.Contains("schema=1", StringComparison.OrdinalIgnoreCase)
            && content.Contains("state=ready", StringComparison.OrdinalIgnoreCase)
            && content.Contains("installedAt=", StringComparison.OrdinalIgnoreCase);
    }

    internal static string? ReadCommit(string? content)
    {
        if (string.IsNullOrWhiteSpace(content))
            return null;

        foreach (var line in content.Split('\n'))
        {
            var separator = line.IndexOf('=');
            if (separator > 0
                && line[..separator].Trim().Equals("commit", StringComparison.OrdinalIgnoreCase))
            {
                var commit = line[(separator + 1)..].Trim();
                return string.IsNullOrWhiteSpace(commit) ? null : commit;
            }
        }

        return null;
    }
}
