using System.Text;
using System.Text.Json;

namespace Phoenix.Desktop;

/// <summary>One bounded response from Phoenix Desktop's temporary credential prompt.</summary>
internal sealed class DesktopCredentialPromptReply
{
    internal string RequestId { get; }
    internal string Origin { get; }
    internal bool Cancelled { get; }
    internal string? Account { get; }
    internal string? Secret { get; }
    internal bool Remember { get; }

    internal DesktopCredentialPromptReply(
        string requestId,
        string origin,
        bool cancelled,
        string? account = null,
        string? secret = null,
        bool remember = false)
    {
        RequestId = requestId;
        Origin = origin;
        Cancelled = cancelled;
        Account = account;
        Secret = secret;
        Remember = remember;
    }
}

/// <summary>Validation rules for credential messages that cross the Phoenix WebView2 bridge.</summary>
internal static class DesktopCredentialPromptProtocol
{
    internal const int MaxMessageBytes = 8_192;
    internal const int MaxAccountLength = 512;
    internal const int MaxSecretLength = 4_096;

    private const string ResponseKind = "computer-credential-response";
    private const string CancellationKind = "computer-credential-cancelled";

    /// <summary>Parse a bounded response without accepting extra or duplicate properties.</summary>
    internal static bool TryParseReply(string json, out DesktopCredentialPromptReply reply)
    {
        reply = new DesktopCredentialPromptReply(string.Empty, string.Empty, cancelled: true);
        if (Encoding.UTF8.GetByteCount(json) > MaxMessageBytes) return false;

        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 4 });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return false;

            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in root.EnumerateObject())
            {
                if (!seen.Add(property.Name)) return false;
            }

            if (!TryGetString(root, "kind", out var kind)
                || !TryGetString(root, "requestId", out var requestId)
                || !Guid.TryParseExact(requestId, "N", out _)
                || !TryGetString(root, "origin", out var rawOrigin))
                return false;

            var origin = BrowserNavigation.NormalizeCredentialOrigin(rawOrigin);
            if (origin is null
                || !origin.StartsWith("https://", StringComparison.Ordinal)
                || !string.Equals(origin, rawOrigin, StringComparison.Ordinal))
                return false;

            if (kind == CancellationKind)
            {
                if (seen.Count != 3) return false;
                reply = new DesktopCredentialPromptReply(requestId, origin, cancelled: true);
                return true;
            }

            if (kind != ResponseKind
                || seen.Count != 6
                || !TryGetString(root, "account", out var account)
                || account.Length > MaxAccountLength
                || account.Any(char.IsControl)
                || !TryGetString(root, "secret", out var secret)
                || secret.Length > MaxSecretLength
                || !root.TryGetProperty("remember", out var rememberNode)
                || rememberNode.ValueKind is not JsonValueKind.True and not JsonValueKind.False)
                return false;

            reply = new DesktopCredentialPromptReply(
                requestId,
                origin,
                cancelled: false,
                account,
                secret,
                rememberNode.GetBoolean());
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    /// <summary>Check that a prompt response matches the one pending origin-bound request.</summary>
    internal static bool MatchesRequest(
        string expectedRequestId,
        string expectedOrigin,
        DesktopCredentialPromptReply reply) =>
        string.Equals(expectedRequestId, reply.RequestId, StringComparison.Ordinal)
        && string.Equals(expectedOrigin, reply.Origin, StringComparison.Ordinal);

    /// <summary>Accept only a WebView2 top-level message from Phoenix's current trusted page.</summary>
    internal static bool IsTrustedShellMessageSource(
        string source,
        string currentSource,
        Uri phoenixUri)
    {
        if (!Uri.TryCreate(source, UriKind.Absolute, out var sourceUri)
            || !Uri.TryCreate(currentSource, UriKind.Absolute, out var currentUri))
            return false;

        return DesktopPhoenixLoopback.IsPhoenixOrigin(sourceUri, phoenixUri)
            && DesktopPhoenixLoopback.IsPhoenixOrigin(currentUri, phoenixUri)
            && string.Equals(sourceUri.AbsoluteUri, currentUri.AbsoluteUri, StringComparison.Ordinal);
    }

    private static bool TryGetString(JsonElement root, string name, out string value)
    {
        value = string.Empty;
        if (!root.TryGetProperty(name, out var node) || node.ValueKind != JsonValueKind.String)
            return false;
        value = node.GetString() ?? string.Empty;
        return value.Length > 0;
    }
}
