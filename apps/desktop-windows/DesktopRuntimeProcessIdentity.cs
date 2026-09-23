using System.Runtime.InteropServices;

namespace Phoenix.Desktop;

internal static class DesktopRuntimeProcessIdentity
{
    private const int ErrorNoMoreFiles = 18;
    private const uint SnapshotAllProcesses = 0x00000002;
    private static readonly nint InvalidHandleValue = new(-1);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry32
    {
        internal uint Size;
        internal uint Usage;
        internal uint ProcessId;
        internal nint DefaultHeapId;
        internal uint ModuleId;
        internal uint ThreadCount;
        internal uint ParentProcessId;
        internal int PriorityBase;
        internal uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        internal string? ExecutableFileName;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern nint CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "Process32FirstW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32First(nint snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "Process32NextW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32Next(nint snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(nint handle);

    internal static bool IsSameOrDescendantOf(int processId, int ancestorProcessId)
    {
        if (!OperatingSystem.IsWindows() || processId <= 0 || ancestorProcessId <= 0)
            return false;

        var snapshot = CreateToolhelp32Snapshot(SnapshotAllProcesses, 0);
        if (snapshot == InvalidHandleValue)
            return false;

        try
        {
            var parents = new Dictionary<int, int>();
            var entry = new ProcessEntry32
            {
                Size = (uint)Marshal.SizeOf<ProcessEntry32>(),
                ExecutableFileName = string.Empty,
            };
            if (!Process32First(snapshot, ref entry))
                return false;

            do
            {
                if (entry.ProcessId > 0 && entry.ParentProcessId > 0)
                    parents[(int)entry.ProcessId] = (int)entry.ParentProcessId;
            }
            while (Process32Next(snapshot, ref entry));

            if (Marshal.GetLastWin32Error() != ErrorNoMoreFiles)
                return false;

            return IsSameOrDescendantOf(processId, ancestorProcessId, parents);
        }
        catch
        {
            return false;
        }
        finally
        {
            _ = CloseHandle(snapshot);
        }
    }

    internal static bool IsSameOrDescendantOf(
        int processId,
        int ancestorProcessId,
        IReadOnlyDictionary<int, int> parentProcessIds)
    {
        if (processId <= 0 || ancestorProcessId <= 0)
            return false;

        var visited = new HashSet<int>();
        var current = processId;
        while (current > 0 && visited.Add(current))
        {
            if (current == ancestorProcessId)
                return true;
            if (!parentProcessIds.TryGetValue(current, out var parentProcessId))
                return false;
            current = parentProcessId;
        }

        return false;
    }
}
