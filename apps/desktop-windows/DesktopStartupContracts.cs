using System.Diagnostics;

namespace Phoenix.Desktop;

internal static class DesktopStartupContract
{
    internal const bool ShowWindowBeforeRuntimeReady = true;
    internal const bool SecondLaunchSignalsExistingWindow = true;
    internal const bool EmbeddedBrowserStartsLazy = true;
    internal const string InitialStatus = "Preparando Phoenix…";
}

internal static class DesktopRuntimeLaunchContract
{
    internal const int DesktopPort = 3081;
    internal const string PowerShellExecutable = "powershell.exe";

    internal static ProcessStartInfo CreateOwnedRuntimeStartInfo(
        string runtimeRoot,
        string controlDescriptorPath,
        bool managedRuntime = true)
    {
        var launcher = Path.Combine(runtimeRoot, "phoenix-windows.cmd");
        var escapedLauncher = launcher.Replace("'", "''");

        var startInfo = new ProcessStartInfo
        {
            FileName = PowerShellExecutable,
            WorkingDirectory = runtimeRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        startInfo.ArgumentList.Add("-NoLogo");
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-NonInteractive");
        startInfo.ArgumentList.Add("-ExecutionPolicy");
        startInfo.ArgumentList.Add("Bypass");
        startInfo.ArgumentList.Add("-Command");
        startInfo.ArgumentList.Add($"& '{escapedLauncher}' --port {DesktopPort} --no-open; exit $LASTEXITCODE");

        if (managedRuntime)
            startInfo.Environment["PHOENIX_DESKTOP_MANAGED"] = "1";
        else
            startInfo.Environment.Remove("PHOENIX_DESKTOP_MANAGED");
        startInfo.Environment["PHOENIX_DESKTOP_CONTROL_DESCRIPTOR"] = controlDescriptorPath;
        startInfo.Environment["PHOENIX_SURFACE"] = "desktop";
        startInfo.Environment["PHOENIX_DESKTOP_SHELL"] = "1";
        startInfo.Environment["PHOENIX_BROWSER_AUTOSTART"] = "true";
        startInfo.Environment["PHOENIX_BROWSER_PREFERRED_ENGINE"] = "chrome";
        return startInfo;
    }
}


internal static class DesktopSourceCheckout
{
    internal const string PointerFileName = "source-root.txt";

    internal static string PointerPath(string installRoot) =>
        Path.Combine(installRoot, PointerFileName);

    internal static bool IsRunnable(string? root)
    {
        if (string.IsNullOrWhiteSpace(root)) return false;
        try
        {
            var full = Path.GetFullPath(root);
            return Directory.Exists(full)
                && Directory.Exists(Path.Combine(full, ".git"))
                && File.Exists(Path.Combine(full, "package.json"))
                && File.Exists(Path.Combine(full, "phoenix-windows.cmd"))
                && Directory.Exists(Path.Combine(full, "node_modules", ".pnpm"));
        }
        catch
        {
            return false;
        }
    }

    internal static IReadOnlyList<string> CandidateRoots(string installRoot)
    {
        var values = new List<string>();
        var configured = Environment.GetEnvironmentVariable("PHOENIX_SOURCE_ROOT");
        if (!string.IsNullOrWhiteSpace(configured))
            values.Add(configured);

        var pointer = PointerPath(installRoot);
        if (File.Exists(pointer))
        {
            try
            {
                var remembered = File.ReadAllText(pointer).Trim();
                if (!string.IsNullOrWhiteSpace(remembered))
                    values.Add(remembered);
            }
            catch
            {
                // A stale pointer must never block discovery.
            }
        }

        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!string.IsNullOrWhiteSpace(home))
        {
            values.Add(Path.Combine(home, "OneDrive", "Documentos", "ChatGPT", "Phoenix", "phoenix-harnes"));
            values.Add(Path.Combine(home, "OneDrive", "Documents", "ChatGPT", "Phoenix", "phoenix-harnes"));
            values.Add(Path.Combine(home, "Documents", "ChatGPT", "Phoenix", "phoenix-harnes"));
            values.Add(Path.Combine(home, "ChatGPT", "Phoenix", "phoenix-harnes"));
            values.Add(Path.Combine(home, "Phoenix", "phoenix-harnes"));
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

    internal static string? Resolve(string installRoot)
    {
        foreach (var candidate in CandidateRoots(installRoot))
        {
            if (!IsRunnable(candidate)) continue;
            Remember(installRoot, candidate);
            return candidate;
        }
        return null;
    }

    internal static void Remember(string installRoot, string root)
    {
        try
        {
            Directory.CreateDirectory(installRoot);
            File.WriteAllText(PointerPath(installRoot), Path.GetFullPath(root));
        }
        catch
        {
            // Discovery still succeeded; persistence is only a convenience.
        }
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
}
