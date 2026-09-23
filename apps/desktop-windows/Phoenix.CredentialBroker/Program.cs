using System.ComponentModel;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Win32.SafeHandles;

namespace Phoenix.CredentialBroker;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        if (!OperatingSystem.IsWindows())
        {
            Console.Error.WriteLine("Phoenix Credential Broker requires Windows.");
            return 2;
        }

        try
        {
            var options = BrokerOptions.Parse(args);
            using var worker = new BrokerWorker(options);
            await worker.RunAsync().ConfigureAwait(false);
            return 0;
        }
        catch (OperationCanceledException)
        {
            return 0;
        }
        catch (Exception)
        {
            Console.Error.WriteLine("Phoenix Credential Broker stopped before completing its request.");
            return 1;
        }
    }
}

internal sealed record BrokerOptions(string PipeName, string TargetPrefix, int HostProcessId, string UserSid)
{
    internal static BrokerOptions Parse(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < args.Length; index++)
        {
            if (!args[index].StartsWith("--", StringComparison.Ordinal) || index + 1 >= args.Length)
                throw new ArgumentException("Invalid broker arguments.");
            values[args[index]] = args[++index];
        }

        var pipe = Required(values, "--pipe");
        var targetPrefix = Required(values, "--target-prefix");
        var userSid = Required(values, "--user-sid");
        if (!int.TryParse(Required(values, "--host-pid"), out var hostPid) || hostPid <= 0
            || pipe.Length is 0 or > 128
            || targetPrefix.Length > 200)
            throw new ArgumentException("Invalid broker arguments.");

        _ = new SecurityIdentifier(userSid);
        return new BrokerOptions(pipe, targetPrefix, hostPid, userSid);
    }

    private static string Required(IReadOnlyDictionary<string, string> values, string key) =>
        values.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new ArgumentException("A required broker argument is missing.");
}

internal sealed class BrokerWorker : IDisposable
{
    private const int MaximumLineBytes = 16 * 1024;
    private const int MaximumRememberedNonces = 4096;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    private readonly BrokerOptions options;
    private readonly CredentialVaultStore store;
    private readonly Dictionary<string, Capability> capabilities = new(StringComparer.Ordinal);
    private readonly Dictionary<string, DateTimeOffset> usedNonces = new(StringComparer.Ordinal);
    private readonly CancellationTokenSource stopping = new();
    private bool disposed;

    internal BrokerWorker(BrokerOptions options)
    {
        this.options = options;
        store = new CredentialVaultStore(options.TargetPrefix);
    }

    internal async Task RunAsync()
    {
        while (!stopping.IsCancellationRequested)
        {
            using var pipe = CreatePipe();
            try
            {
                await pipe.WaitForConnectionAsync(stopping.Token).ConfigureAwait(false);
                if (!NativeMethods.GetNamedPipeClientProcessId(pipe.SafePipeHandle, out var clientPid)
                    || clientPid != options.HostProcessId)
                {
                    pipe.Disconnect();
                    continue;
                }

                var line = await ReadLineLimitedAsync(pipe, MaximumLineBytes, stopping.Token).ConfigureAwait(false);
                if (line is null)
                    continue;

                var response = await HandleAsync(line, stopping.Token).ConfigureAwait(false);
                await WriteLineAsync(pipe, response, stopping.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stopping.IsCancellationRequested)
            {
                break;
            }
            catch (IOException)
            {
                // A disconnected host causes the next request to reconnect while the host is alive.
            }
            catch (UnauthorizedAccessException)
            {
                // An unauthorized client or a protected store remains unavailable to this request.
            }
        }
    }

    private NamedPipeServerStream CreatePipe()
    {
        var securityDescriptor = new RawSecurityDescriptor(
            $"D:P(A;;GA;;;{options.UserSid})(A;;GA;;;SY)");
        var descriptorBytes = new byte[securityDescriptor.BinaryLength];
        securityDescriptor.GetBinaryForm(descriptorBytes, 0);
        var descriptorPointer = Marshal.AllocHGlobal(descriptorBytes.Length);
        var attributesPointer = Marshal.AllocHGlobal(Marshal.SizeOf<NativeMethods.SECURITY_ATTRIBUTES>());
        try
        {
            Marshal.Copy(descriptorBytes, 0, descriptorPointer, descriptorBytes.Length);
            var attributes = new NativeMethods.SECURITY_ATTRIBUTES
            {
                Length = Marshal.SizeOf<NativeMethods.SECURITY_ATTRIBUTES>(),
                SecurityDescriptor = descriptorPointer,
                InheritHandle = false,
            };
            Marshal.StructureToPtr(attributes, attributesPointer, fDeleteOld: false);
            var handle = NativeMethods.CreateNamedPipeW(
                $"\\\\.\\pipe\\{options.PipeName}",
                NativeMethods.PipeAccessDuplex | NativeMethods.FileFlagOverlapped,
                NativeMethods.PipeTypeByte | NativeMethods.PipeReadModeByte | NativeMethods.PipeWait,
                1,
                MaximumLineBytes,
                MaximumLineBytes,
                0,
                attributesPointer);
            if (handle.IsInvalid)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows rejected the broker pipe ACL.");
            return new NamedPipeServerStream(PipeDirection.InOut, isAsync: true, isConnected: false, handle);
        }
        finally
        {
            Marshal.FreeHGlobal(attributesPointer);
            Marshal.FreeHGlobal(descriptorPointer);
        }
    }

    private async Task<string> HandleAsync(string line, CancellationToken cancellationToken)
    {
        if (!BrokerRequest.TryParse(line, out var request))
            return BrokerResponse.Invalid("invalid_request");

        if (!TryAcceptNonce(request))
            return BrokerResponse.Failure(request, "replay").Serialize();

        if (request.Operation == BrokerOperations.Ping)
            return BrokerResponse.Success(request).Serialize();

        try
        {
            return request.Operation switch
            {
                BrokerOperations.Store => await StoreAsync(request, cancellationToken).ConfigureAwait(false),
                BrokerOperations.Has => await HasAsync(request, cancellationToken).ConfigureAwait(false),
                BrokerOperations.FillOnce => await FillOnceAsync(request, cancellationToken).ConfigureAwait(false),
                BrokerOperations.Forget => await ForgetAsync(request, cancellationToken).ConfigureAwait(false),
                BrokerOperations.IssueCapability => IssueCapability(request),
                _ => BrokerResponse.Failure(request, "invalid_operation").Serialize(),
            };
        }
        catch (ArgumentException)
        {
            return BrokerResponse.Failure(request, "invalid_request").Serialize();
        }
        catch (InvalidDataException)
        {
            return BrokerResponse.Failure(request, "vault_unavailable").Serialize();
        }
        catch (SecurityException)
        {
            return BrokerResponse.Failure(request, "vault_unavailable").Serialize();
        }
        catch (UnauthorizedAccessException)
        {
            return BrokerResponse.Failure(request, "vault_unavailable").Serialize();
        }
        catch (IOException)
        {
            return BrokerResponse.Failure(request, "vault_unavailable").Serialize();
        }
    }

    private async Task<string> StoreAsync(BrokerRequest request, CancellationToken cancellationToken)
    {
        if (request.Account is null || request.Secret is null || request.Remember is null)
            return BrokerResponse.Failure(request, "invalid_request").Serialize();

        await store.StoreAsync(request.Origin, request.Account, request.Secret, request.Remember.Value, cancellationToken).ConfigureAwait(false);
        return BrokerResponse.Success(request).Serialize();
    }

    private async Task<string> HasAsync(BrokerRequest request, CancellationToken cancellationToken)
    {
        var hasCredential = await store.HasAsync(request.Origin, cancellationToken).ConfigureAwait(false);
        return BrokerResponse.Success(request, hasCredential: hasCredential).Serialize();
    }

    private async Task<string> FillOnceAsync(BrokerRequest request, CancellationToken cancellationToken)
    {
        if (request.Capability is null || !TryConsumeCapability(request, out _))
            return BrokerResponse.Failure(request, "capability_required").Serialize();

        var value = await store.FillOnceAsync(request.Origin, cancellationToken).ConfigureAwait(false);
        return value is { } credential
            ? BrokerResponse.Success(request, account: credential.Account, secret: credential.Secret).Serialize()
            : BrokerResponse.Failure(request, "credential_missing").Serialize();
    }

    private async Task<string> ForgetAsync(BrokerRequest request, CancellationToken cancellationToken)
    {
        await store.ForgetAsync(request.Origin, cancellationToken).ConfigureAwait(false);
        return BrokerResponse.Success(request).Serialize();
    }

    private string IssueCapability(BrokerRequest request)
    {
        if (request.Capability is not null || request.Account is not null || request.Secret is not null || request.Remember is not null)
            return BrokerResponse.Failure(request, "invalid_request").Serialize();

        var capability = CreateCapability();
        capabilities[Hash(capability)] = new Capability(request.Origin, request.ExpiresAtUtc);
        return BrokerResponse.Success(request, capability: capability).Serialize();
    }

    private bool TryConsumeCapability(BrokerRequest request, out Capability capability)
    {
        capability = default!;
        if (request.Capability is null || !capabilities.Remove(Hash(request.Capability), out var found))
            return false;
        if (!string.Equals(found.Origin, request.Origin, StringComparison.Ordinal)
            || found.ExpiresAtUtc <= DateTimeOffset.UtcNow)
            return false;
        capability = found;
        return true;
    }

    private bool TryAcceptNonce(BrokerRequest request)
    {
        var now = DateTimeOffset.UtcNow;
        List<string>? expired = null;
        foreach (var entry in usedNonces)
        {
            if (entry.Value <= now)
                (expired ??= new List<string>()).Add(entry.Key);
        }

        if (expired is not null)
        {
            foreach (var nonce in expired)
                usedNonces.Remove(nonce);
        }

        if (usedNonces.Count >= MaximumRememberedNonces || usedNonces.ContainsKey(request.Nonce))
            return false;

        usedNonces.Add(request.Nonce, request.ExpiresAtUtc);
        return true;
    }

    private static string CreateCapability()
    {
        Span<byte> bytes = stackalloc byte[32];
        System.Security.Cryptography.RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    private static string Hash(string value)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(bytes);
    }

    private static async Task<string?> ReadLineLimitedAsync(Stream stream, int maxBytes, CancellationToken cancellationToken)
    {
        var buffer = new byte[maxBytes];
        var length = 0;
        while (length < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(length, 1), cancellationToken).ConfigureAwait(false);
            if (read == 0)
                return length == 0 ? null : throw new InvalidDataException("The broker request was truncated.");
            if (buffer[length++] == (byte)'\n')
                return Encoding.UTF8.GetString(buffer, 0, length - 1).TrimEnd('\r');
        }

        throw new InvalidDataException("The broker request is too large.");
    }

    private static async Task WriteLineAsync(Stream stream, string response, CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(response + "\n");
        await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    public void Dispose()
    {
        if (disposed)
            return;
        disposed = true;
        stopping.Cancel();
        stopping.Dispose();
    }

    private sealed record Capability(string Origin, DateTimeOffset ExpiresAtUtc);

    private static class NativeMethods
    {
        internal const int PipeAccessDuplex = 0x00000003;
        internal const int FileFlagOverlapped = 0x40000000;
        internal const int PipeTypeByte = 0x00000000;
        internal const int PipeReadModeByte = 0x00000000;
        internal const int PipeWait = 0x00000000;

        [StructLayout(LayoutKind.Sequential)]
        internal struct SECURITY_ATTRIBUTES
        {
            internal int Length;
            internal IntPtr SecurityDescriptor;
            [MarshalAs(UnmanagedType.Bool)]
            internal bool InheritHandle;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern SafePipeHandle CreateNamedPipeW(
            string name,
            int openMode,
            int pipeMode,
            int maxInstances,
            int outBufferSize,
            int inBufferSize,
            int defaultTimeout,
            IntPtr securityAttributes);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint clientProcessId);

    }
}

internal sealed record BrokerRequest(
    [property: JsonPropertyName("schema")] int Schema,
    [property: JsonPropertyName("requestId")] string RequestId,
    [property: JsonPropertyName("origin")] string Origin,
    [property: JsonPropertyName("operation")] string Operation,
    [property: JsonPropertyName("nonce")] string Nonce,
    [property: JsonPropertyName("expiresAtUtc")] DateTimeOffset ExpiresAtUtc,
    [property: JsonPropertyName("capability")] string? Capability = null,
    [property: JsonPropertyName("account")] string? Account = null,
    [property: JsonPropertyName("secret")] string? Secret = null,
    [property: JsonPropertyName("remember")] bool? Remember = null)
{
    private const int MaximumPersistentSecretBytes = 512;

    public override string ToString() =>
        $"BrokerRequest {{ Schema={Schema}, RequestId={RequestId}, Origin={Origin}, Operation={Operation}, ExpiresAtUtc={ExpiresAtUtc:O}, Remember={Remember}, Capability=<redacted>, Account=<redacted>, Secret=<redacted> }}";

    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        NumberHandling = JsonNumberHandling.Strict,
    };

    internal static bool TryParse(string json, out BrokerRequest request)
    {
        request = new BrokerRequest(0, string.Empty, string.Empty, string.Empty, string.Empty, default);
        if (string.IsNullOrWhiteSpace(json) || Encoding.UTF8.GetByteCount(json) > 16 * 1024)
            return false;
        try
        {
            var parsed = JsonSerializer.Deserialize<BrokerRequest>(json, JsonOptions);
            if (parsed is null
                || parsed.Schema != 1
                || !SafeToken(parsed.RequestId, 128)
                || !SafeToken(parsed.Nonce, 128)
                || !BrokerOperations.IsKnown(parsed.Operation)
                || BrokerOrigin.Normalize(parsed.Origin) is not { } canonicalOrigin
                || !string.Equals(canonicalOrigin, parsed.Origin, StringComparison.Ordinal)
                || parsed.ExpiresAtUtc <= DateTimeOffset.UtcNow
                || parsed.ExpiresAtUtc > DateTimeOffset.UtcNow.AddMinutes(5)
                || (parsed.Capability is not null && !SafeToken(parsed.Capability, 512))
                || (parsed.Account is not null && !Bounded(parsed.Account, 1024))
                || (parsed.Secret is not null && !Bounded(parsed.Secret, 4096))
                || (parsed.Remember == true
                    && parsed.Secret is not null
                    && Encoding.UTF8.GetByteCount(parsed.Secret) > MaximumPersistentSecretBytes))
                return false;
            request = parsed;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool SafeToken(string value, int maxLength) =>
        !string.IsNullOrWhiteSpace(value) && value.Length <= maxLength
        && value.All(static ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_' or '.' or '~');

    private static bool Bounded(string value, int maxLength) =>
        value.Length <= maxLength && !value.Contains('\0');
}

internal static class BrokerOperations
{
    internal const string Store = "store";
    internal const string Has = "has";
    internal const string FillOnce = "fill-once";
    internal const string Forget = "forget";
    internal const string IssueCapability = "issue-capability";
    internal const string Ping = "ping";

    internal static bool IsKnown(string operation) => operation is Store or Has or FillOnce or Forget or IssueCapability or Ping;
}

internal sealed record BrokerResponse(
    [property: JsonPropertyName("schema")] int Schema,
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("requestId")] string RequestId,
    [property: JsonPropertyName("hasCredential")] bool? HasCredential = null,
    [property: JsonPropertyName("capability")] string? Capability = null,
    [property: JsonPropertyName("account")] string? Account = null,
    [property: JsonPropertyName("secret")] string? Secret = null)
{
    public override string ToString() =>
        $"BrokerResponse {{ Schema={Schema}, Ok={Ok}, Code={Code}, RequestId={RequestId}, HasCredential={HasCredential}, Capability=<redacted>, Account=<redacted>, Secret=<redacted> }}";

    internal static BrokerResponse Success(BrokerRequest request, bool? hasCredential = null, string? capability = null, string? account = null, string? secret = null) =>
        new(1, true, "ok", request.RequestId, hasCredential, capability, account, secret);

    internal static BrokerResponse Failure(BrokerRequest request, string code) => new(1, false, code, request.RequestId);

    internal static string Invalid(string code) => JsonSerializer.Serialize(new BrokerResponse(1, false, code, string.Empty));

    internal string Serialize() => JsonSerializer.Serialize(this, BrokerRequest.JsonOptions);
}

internal static class BrokerOrigin
{
    internal static string? Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 2048
            || !Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || !string.IsNullOrEmpty(uri.UserInfo)
            || string.IsNullOrWhiteSpace(uri.Host)
            || uri.HostNameType is UriHostNameType.Unknown or UriHostNameType.Basic)
            return null;

        var host = uri.IdnHost.TrimEnd('.').ToLowerInvariant();
        if (host.Length == 0)
            return null;
        return uri.IsDefaultPort ? $"https://{host}" : $"https://{host}:{uri.Port}";
    }
}
