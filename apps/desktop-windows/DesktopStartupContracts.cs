namespace Phoenix.Desktop;

internal static class DesktopStartupContract
{
    internal const bool ShowWindowBeforeRuntimeReady = true;
    internal const bool SecondLaunchSignalsExistingWindow = true;
    internal const string InitialStatus = "Preparando Phoenix…";
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
