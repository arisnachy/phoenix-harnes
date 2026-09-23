using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Phoenix.Desktop;

/// <summary>
/// A request sent over the broker's private pipe. The request is deliberately separate from
/// <see cref="DesktopComputerRequest"/> so credentials never enter the general Computer channel.
/// </summary>
public sealed record DesktopCredentialRequest(
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
    /// <summary>Returns request metadata without including credential material or bearer tokens.</summary>
    public override string ToString() =>
        $"DesktopCredentialRequest {{ Schema={Schema}, RequestId={RequestId}, Origin={Origin}, Operation={Operation}, ExpiresAtUtc={ExpiresAtUtc:O}, Remember={Remember}, Capability=<redacted>, Account=<redacted>, Secret=<redacted> }}";

    /// <summary>Current private broker protocol version.</summary>
    public const int CurrentSchema = 1;

    /// <summary>Maximum serialized request size accepted by the broker.</summary>
    public const int MaxSerializedBytes = 16 * 1024;

    /// <summary>Maximum UTF-8 secret size accepted for a remembered Credential Manager entry.</summary>
    public const int MaxPersistentSecretBytes = 512;

    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        NumberHandling = JsonNumberHandling.Strict,
    };

    /// <summary>Creates a request with a fresh opaque request id and nonce.</summary>
    public static DesktopCredentialRequest Create(
        string origin,
        string operation,
        TimeSpan lifetime,
        string? capability = null,
        string? account = null,
        string? secret = null,
        bool? remember = null)
    {
        var canonicalOrigin = CredentialOrigin.Normalize(origin)
            ?? throw new ArgumentException("The credential origin must be an HTTPS origin.", nameof(origin));
        if (!CredentialBrokerOperations.IsKnown(operation))
            throw new ArgumentException("The credential operation is not supported.", nameof(operation));
        if (lifetime <= TimeSpan.Zero || lifetime > TimeSpan.FromMinutes(5))
            throw new ArgumentOutOfRangeException(nameof(lifetime));
        if (remember == true
            && secret is not null
            && Encoding.UTF8.GetByteCount(secret) > MaxPersistentSecretBytes)
            throw new ArgumentException("The remembered secret exceeds the Windows Credential Manager limit.", nameof(secret));

        return new DesktopCredentialRequest(
            CurrentSchema,
            Guid.NewGuid().ToString("N"),
            canonicalOrigin,
            operation,
            CreateNonce(),
            DateTimeOffset.UtcNow.Add(lifetime),
            capability,
            account,
            secret,
            remember);
    }

    /// <summary>Serializes a request for the private broker pipe.</summary>
    public string Serialize() => JsonSerializer.Serialize(this, JsonOptions);

    /// <summary>Parses and validates a request without exposing malformed values as exceptions.</summary>
    public static bool TryParse(string json, out DesktopCredentialRequest request)
    {
        request = new DesktopCredentialRequest(0, string.Empty, string.Empty, string.Empty, string.Empty, default);
        if (string.IsNullOrWhiteSpace(json) || json.Length > MaxSerializedBytes)
            return false;

        try
        {
            var parsed = JsonSerializer.Deserialize<DesktopCredentialRequest>(json, JsonOptions);
            if (parsed is null
                || parsed.Schema != CurrentSchema
                || !IsSafeToken(parsed.RequestId, 128)
                || !IsSafeToken(parsed.Nonce, 128)
                || !CredentialBrokerOperations.IsKnown(parsed.Operation)
                || CredentialOrigin.Normalize(parsed.Origin) is not { } canonicalOrigin
                || !string.Equals(canonicalOrigin, parsed.Origin, StringComparison.Ordinal)
                || parsed.ExpiresAtUtc <= DateTimeOffset.UtcNow
                || parsed.ExpiresAtUtc > DateTimeOffset.UtcNow.AddMinutes(5)
                || (parsed.Capability is not null && !IsSafeToken(parsed.Capability, 512))
                || (parsed.Account is not null && !IsBoundedValue(parsed.Account, 1024))
                || (parsed.Secret is not null && !IsBoundedValue(parsed.Secret, 4096))
                || (parsed.Remember == true
                    && parsed.Secret is not null
                    && Encoding.UTF8.GetByteCount(parsed.Secret) > MaxPersistentSecretBytes))
                return false;

            request = parsed;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    /// <summary>Creates a cryptographically random nonce for one broker request.</summary>
    public static string CreateNonce()
    {
        Span<byte> bytes = stackalloc byte[32];
        System.Security.Cryptography.RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    private static bool IsSafeToken(string value, int maxLength) =>
        !string.IsNullOrWhiteSpace(value)
        && value.Length <= maxLength
        && value.All(static ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_' or '.' or '~');

    private static bool IsBoundedValue(string value, int maxLength) =>
        value.Length <= maxLength && !value.Contains('\0');
}

/// <summary>Fixed operation names accepted by the broker.</summary>
public static class CredentialBrokerOperations
{
    /// <summary>Stores a credential in memory or in the current user's Windows Credential Manager.</summary>
    public const string Store = "store";

    /// <summary>Checks whether a credential exists for an origin.</summary>
    public const string Has = "has";

    /// <summary>Consumes a capability and returns a credential once.</summary>
    public const string FillOnce = "fill-once";

    /// <summary>Removes the credential for an origin.</summary>
    public const string Forget = "forget";

    /// <summary>Issues a short lived capability for one fill operation.</summary>
    public const string IssueCapability = "issue-capability";

    internal const string Ping = "ping";

    internal static bool IsKnown(string operation) => operation is
        Store or Has or FillOnce or Forget or IssueCapability or Ping;
}

/// <summary>
/// Fixed response envelope used by the private broker pipe. Secret fields are populated only for
/// a successful <see cref="CredentialBrokerOperations.FillOnce"/> response.
/// </summary>
public sealed record DesktopCredentialResponse(
    [property: JsonPropertyName("schema")] int Schema,
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("requestId")] string RequestId,
    [property: JsonPropertyName("hasCredential")] bool? HasCredential = null,
    [property: JsonPropertyName("capability")] string? Capability = null,
    [property: JsonPropertyName("account")] string? Account = null,
    [property: JsonPropertyName("secret")] string? Secret = null)
{
    /// <summary>Returns response metadata without including credential material or bearer tokens.</summary>
    public override string ToString() =>
        $"DesktopCredentialResponse {{ Schema={Schema}, Ok={Ok}, Code={Code}, RequestId={RequestId}, HasCredential={HasCredential}, Capability=<redacted>, Account=<redacted>, Secret=<redacted> }}";

    internal static DesktopCredentialResponse Success(DesktopCredentialRequest request, bool? hasCredential = null, string? capability = null, string? account = null, string? secret = null) =>
        new(DesktopCredentialRequest.CurrentSchema, true, "ok", request.RequestId, hasCredential, capability, account, secret);

    internal static DesktopCredentialResponse Failure(DesktopCredentialRequest request, string code) =>
        new(DesktopCredentialRequest.CurrentSchema, false, code, request.RequestId);

    internal static DesktopCredentialResponse Invalid(string code) =>
        new(DesktopCredentialRequest.CurrentSchema, false, code, string.Empty);

    internal string Serialize() => JsonSerializer.Serialize(this, DesktopCredentialRequest.JsonOptions);

    internal static bool TryParse(string json, out DesktopCredentialResponse response)
    {
        response = Invalid("invalid_response");
        try
        {
            var parsed = JsonSerializer.Deserialize<DesktopCredentialResponse>(json, DesktopCredentialRequest.JsonOptions);
            if (parsed is null
                || parsed.Schema != DesktopCredentialRequest.CurrentSchema
                || parsed.Code.Length > 64
                || (parsed.Capability is not null && parsed.Capability.Length > 512)
                || (parsed.Account is not null && parsed.Account.Length > 1024)
                || (parsed.Secret is not null && parsed.Secret.Length > 4096))
                return false;
            response = parsed;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}

/// <summary>Short-lived broker authorization without exposing its bearer token in diagnostics.</summary>
public sealed record DesktopCredentialCapability(
    string Token,
    string Origin,
    DateTimeOffset ExpiresAtUtc)
{
    /// <summary>Returns capability metadata without including the bearer token.</summary>
    public override string ToString() =>
        $"DesktopCredentialCapability {{ Origin={Origin}, ExpiresAtUtc={ExpiresAtUtc:O}, Token=<redacted> }}";
}

/// <summary>Credential material returned only to the native host for a single fill.</summary>
public sealed record DesktopCredentialValue(string Account, string Secret)
{
    /// <summary>Returns a fixed redacted representation because both fields are credential material.</summary>
    public override string ToString() => "DesktopCredentialValue { Account=<redacted>, Secret=<redacted> }";
}

/// <summary>Canonical HTTPS origin handling shared by the host and broker.</summary>
public static class CredentialOrigin
{
    /// <summary>Returns a scheme, host, and effective port origin or null for an invalid origin.</summary>
    public static string? Normalize(string? value)
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

        var port = uri.IsDefaultPort ? -1 : uri.Port;
        return port < 0
            ? $"https://{host}"
            : string.Create(CultureInfo.InvariantCulture, $"https://{host}:{port}");
    }
}
