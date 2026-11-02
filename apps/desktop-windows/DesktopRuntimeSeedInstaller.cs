using System.IO.Compression;

namespace Phoenix.Desktop;

/// <summary>
/// Installs the immutable production runtime seed atomically. The caller decides whether to run
/// this synchronously (installer pre-warm) or on a worker thread (interactive EXE startup).
/// </summary>
internal static class DesktopRuntimeSeedInstaller
{
    internal const string ArchiveName = "runtime-seed.zip";

    internal static string ArchivePath(string applicationBaseDirectory) =>
        Path.Combine(applicationBaseDirectory, ArchiveName);

    internal static bool EnsureInstalled(
        string applicationBaseDirectory,
        string runtimeRoot,
        Action<string>? log = null)
    {
        if (ManagedRuntimeMarker.Inspect(runtimeRoot) == ManagedRuntimeState.Ready)
        {
            log?.Invoke("Managed runtime seed already installed and ready.");
            return true;
        }

        var archive = ArchivePath(applicationBaseDirectory);
        if (!File.Exists(archive))
        {
            log?.Invoke($"Bundled runtime seed is missing: {archive}");
            return false;
        }

        var parent = Path.GetDirectoryName(runtimeRoot);
        if (string.IsNullOrWhiteSpace(parent))
        {
            log?.Invoke($"Runtime root has no parent directory: {runtimeRoot}");
            return false;
        }

        var staging = $"{runtimeRoot}.installing-{Guid.NewGuid():N}";
        string? quarantine = null;
        try
        {
            Directory.CreateDirectory(parent);
            if (Directory.Exists(staging))
                Directory.Delete(staging, recursive: true);
            Directory.CreateDirectory(staging);

            log?.Invoke($"Extracting bundled production runtime seed on worker/pre-warm path: {archive} -> {staging}");
            ZipFile.ExtractToDirectory(archive, staging, overwriteFiles: true);

            var marker = Path.Combine(staging, ManagedRuntimeMarker.ReadyMarkerName);
            if (!File.Exists(marker))
            {
                File.WriteAllLines(marker, new[]
                {
                    "schema=1",
                    "state=ready",
                    "channel=stable",
                    $"installedAt={DateTimeOffset.UtcNow:o}",
                    "source=bundled-runtime-seed",
                });
            }

            if (ManagedRuntimeMarker.Inspect(staging) != ManagedRuntimeState.Ready)
                throw new InvalidOperationException("Bundled runtime seed failed staging validation.");

            if (Directory.Exists(runtimeRoot))
            {
                quarantine = $"{runtimeRoot}.replaced-{DateTimeOffset.UtcNow:yyyyMMddHHmmssfff}";
                Directory.Move(runtimeRoot, quarantine);
            }

            Directory.Move(staging, runtimeRoot);
            if (ManagedRuntimeMarker.Inspect(runtimeRoot) != ManagedRuntimeState.Ready)
                throw new InvalidOperationException("Installed bundled runtime failed readiness validation.");

            if (quarantine is not null && Directory.Exists(quarantine))
            {
                try { Directory.Delete(quarantine, recursive: true); }
                catch (Exception cleanupEx) { log?.Invoke($"Could not remove replaced runtime immediately: {cleanupEx.Message}"); }
            }

            log?.Invoke("Bundled production runtime seed installed successfully.");
            return true;
        }
        catch (Exception ex)
        {
            log?.Invoke($"Bundled production runtime seed installation failed: {ex}");

            try
            {
                if (quarantine is not null && Directory.Exists(quarantine))
                {
                    if (Directory.Exists(runtimeRoot))
                        Directory.Delete(runtimeRoot, recursive: true);
                    Directory.Move(quarantine, runtimeRoot);
                }
            }
            catch (Exception restoreEx)
            {
                log?.Invoke($"Could not restore previous managed runtime: {restoreEx}");
            }

            try
            {
                if (Directory.Exists(staging))
                    Directory.Delete(staging, recursive: true);
            }
            catch (Exception cleanupEx)
            {
                log?.Invoke($"Could not remove failed runtime-seed staging directory: {cleanupEx}");
            }

            return false;
        }
    }
}
