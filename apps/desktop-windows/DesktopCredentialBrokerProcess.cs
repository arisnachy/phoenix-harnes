using System.Diagnostics;
using System.ComponentModel;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Phoenix.Desktop;

/// <summary>
/// Owns the lifetime of the per-user Windows Credential Manager broker and its authenticated pipe.
/// The broker is a normal same-user process, so this class does not claim isolation from another
/// process with the same Windows permissions. A kill-on-close job tears it down after host exit.
/// Credential material is sent only on this private pipe; it is absent from process arguments,
/// broker logs, and the general Computer protocol.
/// </summary>
public sealed class DesktopCredentialBrokerProcess : IAsyncDisposable
{
    private const int CreateSuspended = 0x00000004;
    private const int CreateNoWindow = 0x08000000;
    private const int CreateUnicodeEnvironment = 0x00000400;
    private const int MaximumLineBytes = DesktopCredentialRequest.MaxSerializedBytes;

    private readonly Process process;
    private readonly SafeJobHandle job;
    private readonly CancellationTokenSource stopping = new();
    private readonly string clientPipeName;
    private bool disposed;

    private DesktopCredentialBrokerProcess(
        Process process,
        string profileName,
        string pipeName,
        string targetPrefix,
        SafeJobHandle job)
    {
        this.process = process;
        ProfileName = profileName;
        PipeName = pipeName;
        CredentialTargetPrefix = targetPrefix;
        clientPipeName = pipeName;
        this.job = job;
    }

    /// <summary>Stable credential namespace used for this host installation.</summary>
    public string ProfileName { get; }

    /// <summary>Ephemeral pipe name for this broker instance.</summary>
    public string PipeName { get; }

    /// <summary>Credential Manager target prefix used by the broker.</summary>
    public string CredentialTargetPrefix { get; }

    /// <summary>PID of the full-trust Phoenix host that owns this broker.</summary>
    public int HostProcessId => Environment.ProcessId;

    /// <summary>
    /// Starts a normal same-user broker backed by Windows Credential Manager. The method returns
    /// only after a private pipe ping succeeds.
    /// </summary>
    public static async Task<DesktopCredentialBrokerProcess> StartAsync(
        string brokerExecutable,
        string profileName,
        CancellationToken cancellationToken = default)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("The credential broker requires Windows.");
        if (string.IsNullOrWhiteSpace(brokerExecutable))
            throw new ArgumentException("The broker executable is required.", nameof(brokerExecutable));
        if (!File.Exists(brokerExecutable))
            throw new FileNotFoundException("The broker executable was not found.", brokerExecutable);
        ValidateProfileName(profileName);

        var pipeName = $"LOCAL\\PhoenixCredentialBroker.{Guid.NewGuid():N}";
        var targetPrefix = $"Phoenix.Desktop.CredentialBroker.v1.{profileName}";
        var userSid = WindowsIdentity.GetCurrent().User?.Value
            ?? throw new InvalidOperationException("Phoenix has no interactive user SID.");
        var commandLine = string.Join(' ',
            QuoteArgument(brokerExecutable),
            "--pipe", QuoteArgument(pipeName),
            "--target-prefix", QuoteArgument(targetPrefix),
            "--host-pid", Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture),
            "--user-sid", QuoteArgument(userSid));

        NativeMethods.STARTUPINFOEX startupInfo = default;
        startupInfo.StartupInfo.cb = Marshal.SizeOf<NativeMethods.STARTUPINFO>();
        var job = CreateKillOnCloseJob();
        var processInformation = default(NativeMethods.PROCESS_INFORMATION);
        var processTransferred = false;
        try
        {
            if (!NativeMethods.CreateProcessW(
                    brokerExecutable,
                    new StringBuilder(commandLine),
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false,
                    CreateUnicodeEnvironment | CreateNoWindow | CreateSuspended,
                    IntPtr.Zero,
                    Path.GetDirectoryName(Path.GetFullPath(brokerExecutable)),
                    ref startupInfo,
                    out processInformation))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows rejected the credential broker launch.");

            if (!NativeMethods.AssignProcessToJobObject(job, processInformation.hProcess))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows could not bind the broker to the Phoenix host lifetime.");

            if (NativeMethods.ResumeThread(processInformation.hThread) == uint.MaxValue)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows could not resume the credential broker.");

            var process = Process.GetProcessById(checked((int)processInformation.dwProcessId));
            var broker = new DesktopCredentialBrokerProcess(process, profileName, pipeName, targetPrefix, job);
            processTransferred = true;
            try
            {
                await broker.WaitForReadyAsync(cancellationToken).ConfigureAwait(false);
                return broker;
            }
            catch
            {
                await broker.DisposeAsync().ConfigureAwait(false);
                throw;
            }
        }
        catch
        {
            if (!processTransferred && processInformation.hProcess != IntPtr.Zero)
                _ = NativeMethods.TerminateProcess(processInformation.hProcess, 1);
            throw;
        }
        finally
        {
            if (processInformation.hThread != IntPtr.Zero)
                NativeMethods.CloseHandle(processInformation.hThread);
            if (processInformation.hProcess != IntPtr.Zero)
                NativeMethods.CloseHandle(processInformation.hProcess);
            if (!processTransferred)
                job.Dispose();
        }
    }

    private static SafeJobHandle CreateKillOnCloseJob()
    {
        var job = NativeMethods.CreateJobObjectW(IntPtr.Zero, null);
        if (job.IsInvalid)
        {
            var error = Marshal.GetLastWin32Error();
            job.Dispose();
            throw new Win32Exception(error, "Windows could not create the broker lifetime job.");
        }

        var limits = new NativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            BasicLimitInformation = new NativeMethods.JOBOBJECT_BASIC_LIMIT_INFORMATION
            {
                LimitFlags = NativeMethods.JobObjectLimitKillOnJobClose,
            },
        };
        if (!NativeMethods.SetInformationJobObject(
                job,
                NativeMethods.JobObjectExtendedLimitInformation,
                ref limits,
                Marshal.SizeOf<NativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()))
        {
            var error = Marshal.GetLastWin32Error();
            job.Dispose();
            throw new Win32Exception(error, "Windows could not configure the broker lifetime job.");
        }

        return job;
    }

    /// <summary>Stores a credential, retaining it in memory when <paramref name="remember"/> is false.</summary>
    public async Task StoreAsync(string origin, string account, string secret, bool remember, CancellationToken cancellationToken = default)
    {
        var request = DesktopCredentialRequest.Create(origin, CredentialBrokerOperations.Store, TimeSpan.FromMinutes(1), account: account, secret: secret, remember: remember);
        await SendExpectSuccessAsync(request, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Checks whether the broker has a persistent or one-use credential for an origin.</summary>
    public async Task<bool> HasAsync(string origin, CancellationToken cancellationToken = default)
    {
        var request = DesktopCredentialRequest.Create(origin, CredentialBrokerOperations.Has, TimeSpan.FromMinutes(1));
        var response = await SendAsync(request, cancellationToken).ConfigureAwait(false);
        return EnsureResponse(request, response).HasCredential == true;
    }

    /// <summary>Issues a short-lived capability bound to the supplied origin.</summary>
    public async Task<DesktopCredentialCapability> IssueFillCapabilityAsync(string origin, TimeSpan lifetime = default, CancellationToken cancellationToken = default)
    {
        if (lifetime == default)
            lifetime = TimeSpan.FromSeconds(30);
        var request = DesktopCredentialRequest.Create(origin, CredentialBrokerOperations.IssueCapability, lifetime);
        var response = EnsureResponse(request, await SendAsync(request, cancellationToken).ConfigureAwait(false));
        if (string.IsNullOrWhiteSpace(response.Capability))
            throw new InvalidOperationException("The credential broker returned no fill capability.");
        return new DesktopCredentialCapability(response.Capability, request.Origin, request.ExpiresAtUtc);
    }

    /// <summary>Consumes a capability and returns credential material only to the native host.</summary>
    public async Task<DesktopCredentialValue?> FillOnceAsync(
        string origin,
        DesktopCredentialCapability capability,
        CancellationToken cancellationToken = default)
    {
        var canonical = CredentialOrigin.Normalize(origin)
            ?? throw new ArgumentException("The credential origin must be an HTTPS origin.", nameof(origin));
        if (!string.Equals(canonical, capability.Origin, StringComparison.Ordinal))
            throw new ArgumentException("The fill capability belongs to another origin.", nameof(capability));
        var request = DesktopCredentialRequest.Create(
            canonical,
            CredentialBrokerOperations.FillOnce,
            TimeSpan.FromMinutes(1),
            capability: capability.Token);
        var response = EnsureResponse(request, await SendAsync(request, cancellationToken).ConfigureAwait(false));
        return response.Account is not null && response.Secret is not null
            ? new DesktopCredentialValue(response.Account, response.Secret)
            : null;
    }

    /// <summary>Deletes both persistent and one-use credentials for an origin.</summary>
    public async Task ForgetAsync(string origin, CancellationToken cancellationToken = default)
    {
        var request = DesktopCredentialRequest.Create(origin, CredentialBrokerOperations.Forget, TimeSpan.FromMinutes(1));
        await SendExpectSuccessAsync(request, cancellationToken).ConfigureAwait(false);
    }

    private async Task WaitForReadyAsync(CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, stopping.Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        while (true)
        {
            if (process.HasExited)
                throw new InvalidOperationException("The credential broker exited before its private pipe became ready.");
            try
            {
                var request = DesktopCredentialRequest.Create(
                    "https://phoenix.invalid",
                    CredentialBrokerOperations.Ping,
                    TimeSpan.FromSeconds(30));
                await SendExpectSuccessAsync(request, timeout.Token).ConfigureAwait(false);
                return;
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested && !stopping.IsCancellationRequested)
            {
                throw new TimeoutException("The credential broker private pipe did not become ready.");
            }
            catch (TimeoutException) when (!timeout.IsCancellationRequested)
            {
                await Task.Delay(50, timeout.Token).ConfigureAwait(false);
            }
            catch (IOException) when (!timeout.IsCancellationRequested)
            {
                await Task.Delay(50, timeout.Token).ConfigureAwait(false);
            }
        }
    }

    private async Task SendExpectSuccessAsync(DesktopCredentialRequest request, CancellationToken cancellationToken)
    {
        _ = EnsureResponse(request, await SendAsync(request, cancellationToken).ConfigureAwait(false));
    }

    private async Task<DesktopCredentialResponse> SendAsync(DesktopCredentialRequest request, CancellationToken cancellationToken)
    {
        ThrowIfDisposed();
        using var client = new NamedPipeClientStream(
            ".",
            clientPipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous,
            TokenImpersonationLevel.Impersonation);
        await client.ConnectAsync(cancellationToken).ConfigureAwait(false);
        var bytes = Encoding.UTF8.GetBytes(request.Serialize() + "\n");
        await client.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
        await client.FlushAsync(cancellationToken).ConfigureAwait(false);
        var line = await ReadLineLimitedAsync(client, MaximumLineBytes, cancellationToken).ConfigureAwait(false)
            ?? throw new IOException("The credential broker closed its private pipe.");
        if (!DesktopCredentialResponse.TryParse(line, out var response)
            || !string.Equals(response.RequestId, request.RequestId, StringComparison.Ordinal))
            throw new IOException("The credential broker returned an invalid response.");
        return response;
    }

    private static DesktopCredentialResponse EnsureResponse(DesktopCredentialRequest request, DesktopCredentialResponse response)
    {
        if (!response.Ok)
            throw new InvalidOperationException($"Credential broker operation '{request.Operation}' failed with code '{response.Code}'.");
        return response;
    }

    private static async Task<string?> ReadLineLimitedAsync(Stream stream, int maxBytes, CancellationToken cancellationToken)
    {
        var buffer = new byte[maxBytes];
        var length = 0;
        while (length < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(length, 1), cancellationToken).ConfigureAwait(false);
            if (read == 0)
                return length == 0 ? null : throw new IOException("The credential broker response was truncated.");
            if (buffer[length++] == (byte)'\n')
                return Encoding.UTF8.GetString(buffer, 0, length - 1).TrimEnd('\r');
        }
        throw new IOException("The credential broker response is too large.");
    }

    private static string QuoteArgument(string value)
    {
        if (value.Length == 0)
            return "\"\"";
        var builder = new StringBuilder(value.Length + 2);
        builder.Append('"');
        var backslashes = 0;
        foreach (var ch in value)
        {
            if (ch == '\\')
            {
                backslashes++;
                continue;
            }
            if (ch == '"')
            {
                builder.Append('\\', backslashes * 2 + 1);
                builder.Append('"');
                backslashes = 0;
                continue;
            }
            builder.Append('\\', backslashes);
            builder.Append(ch);
            backslashes = 0;
        }
        builder.Append('\\', backslashes * 2);
        builder.Append('"');
        return builder.ToString();
    }

    private static void ValidateProfileName(string profileName)
    {
        if (string.IsNullOrWhiteSpace(profileName) || profileName.Length > 50
            || !profileName.All(static ch => char.IsAsciiLetterOrDigit(ch) || ch is '.' or '-' or '_'))
            throw new ArgumentException("The credential namespace name is invalid.", nameof(profileName));
    }

    private void ThrowIfDisposed()
    {
        if (disposed)
            throw new ObjectDisposedException(nameof(DesktopCredentialBrokerProcess));
    }

    /// <summary>Stops the owned broker and waits for it to exit before returning.</summary>
    public async ValueTask DisposeAsync()
    {
        if (disposed)
            return;
        disposed = true;
        stopping.Cancel();
        try
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync().ConfigureAwait(false);
        }
        catch (InvalidOperationException)
        {
            // The process exited between HasExited and Kill/WaitForExitAsync.
        }
        finally
        {
            process.Dispose();
            job.Dispose();
            stopping.Dispose();
        }
    }

    private sealed class SafeJobHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        internal SafeJobHandle() : base(ownsHandle: true)
        {
        }

        protected override bool ReleaseHandle() => NativeMethods.CloseHandle(handle);
    }

    private static class NativeMethods
    {
        internal const uint JobObjectLimitKillOnJobClose = 0x00002000;
        internal const int JobObjectExtendedLimitInformation = 9;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        internal struct STARTUPINFO
        {
            internal int cb;
            internal string? lpReserved;
            internal string? lpDesktop;
            internal string? lpTitle;
            internal int dwX;
            internal int dwY;
            internal int dwXSize;
            internal int dwYSize;
            internal int dwXCountChars;
            internal int dwYCountChars;
            internal int dwFillAttribute;
            internal int dwFlags;
            internal short wShowWindow;
            internal short cbReserved2;
            internal IntPtr lpReserved2;
            internal IntPtr hStdInput;
            internal IntPtr hStdOutput;
            internal IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct STARTUPINFOEX
        {
            internal STARTUPINFO StartupInfo;
            internal IntPtr lpAttributeList;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct PROCESS_INFORMATION
        {
            internal IntPtr hProcess;
            internal IntPtr hThread;
            internal uint dwProcessId;
            internal uint dwThreadId;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            internal long PerProcessUserTimeLimit;
            internal long PerJobUserTimeLimit;
            internal uint LimitFlags;
            internal UIntPtr MinimumWorkingSetSize;
            internal UIntPtr MaximumWorkingSetSize;
            internal uint ActiveProcessLimit;
            internal UIntPtr Affinity;
            internal uint PriorityClass;
            internal uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct IO_COUNTERS
        {
            internal ulong ReadOperationCount;
            internal ulong WriteOperationCount;
            internal ulong OtherOperationCount;
            internal ulong ReadTransferCount;
            internal ulong WriteTransferCount;
            internal ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            internal JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            internal IO_COUNTERS IoInfo;
            internal UIntPtr ProcessMemoryLimit;
            internal UIntPtr JobMemoryLimit;
            internal UIntPtr PeakProcessMemoryUsed;
            internal UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern bool CreateProcessW(
            string? applicationName,
            StringBuilder commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            bool inheritHandles,
            int creationFlags,
            IntPtr environment,
            string? currentDirectory,
            ref STARTUPINFOEX startupInfo,
            out PROCESS_INFORMATION processInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern uint ResumeThread(IntPtr thread);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern SafeJobHandle CreateJobObjectW(IntPtr jobAttributes, string? name);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool SetInformationJobObject(
            SafeJobHandle job,
            int informationClass,
            ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION jobObjectInformation,
            int jobObjectInformationLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool AssignProcessToJobObject(SafeJobHandle job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool TerminateProcess(IntPtr process, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool CloseHandle(IntPtr handle);
    }
}
