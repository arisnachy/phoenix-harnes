namespace Phoenix.Desktop;

internal static class DesktopBundledToolchain
{
    internal const string ToolchainDirectoryName = "runtime-tools";

    internal static string ToolchainRoot(string applicationBaseDirectory) =>
        Path.Combine(applicationBaseDirectory, ToolchainDirectoryName);

    internal static string NodeExecutable(string applicationBaseDirectory) =>
        Path.Combine(ToolchainRoot(applicationBaseDirectory), "node", "node.exe");

    internal static IReadOnlyList<string> CandidatePathEntries(string applicationBaseDirectory)
    {
        var root = ToolchainRoot(applicationBaseDirectory);
        return new[]
        {
            Path.Combine(root, "node"),
            Path.Combine(root, "git", "cmd"),
            Path.Combine(root, "git", "mingw64", "bin"),
            Path.Combine(root, "git", "usr", "bin"),
        };
    }

    internal static bool Activate(string applicationBaseDirectory)
    {
        var root = ToolchainRoot(applicationBaseDirectory);
        var existingPath = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        var existingEntries = existingPath
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        var additions = CandidatePathEntries(applicationBaseDirectory)
            .Where(Directory.Exists)
            .Where(candidate => !existingEntries.Contains(candidate, StringComparer.OrdinalIgnoreCase))
            .ToArray();

        if (additions.Length == 0)
            return Directory.Exists(root);

        var merged = string.Join(Path.PathSeparator, additions.Concat(existingEntries));
        Environment.SetEnvironmentVariable("PATH", merged);
        Environment.SetEnvironmentVariable("PHOENIX_TOOLCHAIN_ROOT", root);
        return true;
    }
}
