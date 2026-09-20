using System.Net;
using System.Text.Json;

namespace Phoenix.Desktop;

/// <summary>Pure navigation and host-message rules shared by the embedded browser and its contract tests.</summary>
public static class BrowserNavigation
{
    private static readonly HashSet<string> AllowedSchemes = new(StringComparer.OrdinalIgnoreCase)
    {
        Uri.UriSchemeHttp,
        Uri.UriSchemeHttps,
    };

    public static Uri? NormalizeAddress(string? input)
    {
        var value = input?.Trim();
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (string.Equals(value, "about:blank", StringComparison.OrdinalIgnoreCase))
            return new Uri("about:blank");

        // Host-like values must be resolved before Uri.TryCreate(... Absolute): strings such as
        // "localhost:3080" are otherwise interpreted as a custom URI scheme named "localhost".
        if (!value.Contains("://", StringComparison.Ordinal) && LooksLikeHost(value))
        {
            var scheme = IsLocalHost(value) ? Uri.UriSchemeHttp : Uri.UriSchemeHttps;
            if (Uri.TryCreate($"{scheme}://{value}", UriKind.Absolute, out var hostUri))
                return hostUri;
        }

        if (Uri.TryCreate(value, UriKind.Absolute, out var absolute))
            return AllowedSchemes.Contains(absolute.Scheme) ? absolute : null;

        var query = WebUtility.UrlEncode(value);
        return new Uri($"https://www.bing.com/search?q={query}");
    }

    /// <summary>
    /// Canonicalize one origin that may receive an unattended credential.
    /// Remote origins require HTTPS; plaintext HTTP is accepted only for loopback.
    /// Paths, query strings, fragments, and user-info never participate in the grant.
    /// </summary>
    public static string? NormalizeCredentialOrigin(string? input)
    {
        var value = input?.Trim();
        if (string.IsNullOrWhiteSpace(value)
            || !Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || !string.IsNullOrEmpty(uri.UserInfo))
            return null;

        var secure = uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase);
        var localHttp = uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) && uri.IsLoopback;
        if (!secure && !localHttp) return null;

        var builder = new UriBuilder(uri.Scheme.ToLowerInvariant(), uri.Host.ToLowerInvariant(), uri.IsDefaultPort ? -1 : uri.Port);
        return builder.Uri.GetLeftPart(UriPartial.Authority).TrimEnd('/');
    }

    private static bool LooksLikeHost(string value)
    {
        if (value.Any(char.IsWhiteSpace)) return false;
        if (value.StartsWith("localhost", StringComparison.OrdinalIgnoreCase)) return true;
        if (value.StartsWith("127.", StringComparison.Ordinal)) return true;
        if (value.StartsWith("[::1]", StringComparison.OrdinalIgnoreCase)) return true;
        return value.Contains('.', StringComparison.Ordinal);
    }

    private static bool IsLocalHost(string value)
    {
        var host = value;
        var slash = host.IndexOf('/');
        if (slash >= 0) host = host[..slash];
        if (host.StartsWith("[::1]", StringComparison.OrdinalIgnoreCase)) return true;
        var colon = host.LastIndexOf(':');
        if (colon > 0) host = host[..colon];
        return host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host.StartsWith("127.", StringComparison.Ordinal);
    }
}

/// <summary>Pure chat-first sizing policy for the optional embedded browser pane.</summary>
public static class BrowserLayout
{
    public const bool StartCollapsed = true;
    public const int MinimumChatWidth = 640;
    public const int MinimumBrowserWidth = 360;

    /// <summary>
    /// Phoenix desktop split: when the browser is visible it targets 40% of the usable width,
    /// leaving 60% for chat. The host SplitContainer still enforces the minimum chat/browser
    /// widths on compact windows.
    /// </summary>
    public static int PreferredBrowserWidth(int clientWidth)
    {
        var proportional = (int)Math.Round(Math.Max(0, clientWidth) * 0.40d);
        return Math.Max(MinimumBrowserWidth, proportional);
    }
}

/// <summary>One browser-inspection field update. Secret/file inputs are never accepted here.</summary>
public sealed record BrowserFormValue(int Field, string? Value, bool? Checked);

/// <summary>
/// Typed command accepted by the desktop browser bridge. Normal navigation commands may arrive
/// from the Phoenix UI; automation commands are admitted only by the current-user named pipe.
/// </summary>
public sealed record BrowserCommand(
    string Type,
    string? Url = null,
    string? Origin = null,
    string? Account = null,
    string? Secret = null,
    string? Text = null,
    bool Submit = false,
    IReadOnlyList<BrowserFormValue>? Fields = null)
{
    private static readonly HashSet<string> PublicTypes = new(StringComparer.Ordinal)
    {
        "phoenix.browser.open",
        "phoenix.browser.close",
        "phoenix.browser.back",
        "phoenix.browser.forward",
        "phoenix.browser.reload",
        "phoenix.browser.home",
        "phoenix.browser.focus",
        "phoenix.app.logout",
    };

    private static readonly HashSet<string> AutomationTypes = new(StringComparer.Ordinal)
    {
        "phoenix.browser.inspect",
        "phoenix.browser.fill-form",
        "phoenix.browser.click-text",
        "phoenix.browser.login",
    };

    public static bool TryParse(string json, out BrowserCommand command, bool allowAutomation = false)
    {
        command = new BrowserCommand(string.Empty);
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return false;
            if (!doc.RootElement.TryGetProperty("type", out var typeNode)) return false;
            var type = typeNode.GetString();
            if (type is null) return false;

            var isPublic = PublicTypes.Contains(type);
            var isAutomation = allowAutomation && AutomationTypes.Contains(type);
            if (!isPublic && !isAutomation) return false;

            if (type == "phoenix.browser.open")
            {
                if (!TryGetString(doc.RootElement, "url", out var url)
                    || BrowserNavigation.NormalizeAddress(url) is null)
                    return false;
                command = new BrowserCommand(type, Url: url);
                return true;
            }

            if (!AutomationTypes.Contains(type))
            {
                command = new BrowserCommand(type);
                return true;
            }

            if (type == "phoenix.browser.inspect")
            {
                command = new BrowserCommand(type);
                return true;
            }

            if (!TryGetString(doc.RootElement, "origin", out var rawOrigin)) return false;
            var origin = BrowserNavigation.NormalizeCredentialOrigin(rawOrigin);
            if (origin is null) return false;

            if (type == "phoenix.browser.click-text")
            {
                if (!TryGetString(doc.RootElement, "text", out var text)
                    || text.Length > 512)
                    return false;
                command = new BrowserCommand(type, Origin: origin, Text: text);
                return true;
            }

            var submit = type == "phoenix.browser.login";
            if (doc.RootElement.TryGetProperty("submit", out var submitNode))
            {
                if (submitNode.ValueKind is not JsonValueKind.True and not JsonValueKind.False) return false;
                submit = submitNode.GetBoolean();
            }

            if (type == "phoenix.browser.login")
            {
                if (!TryGetString(doc.RootElement, "account", out var account)
                    || account.Length > 4096
                    || !TryGetString(doc.RootElement, "secret", out var secret)
                    || secret.Length > 16384)
                    return false;
                command = new BrowserCommand(
                    type,
                    Origin: origin,
                    Account: account,
                    Secret: secret,
                    Submit: submit);
                return true;
            }

            if (!doc.RootElement.TryGetProperty("fields", out var fieldsNode)
                || fieldsNode.ValueKind != JsonValueKind.Array
                || fieldsNode.GetArrayLength() is < 1 or > 100)
                return false;

            var fields = new List<BrowserFormValue>(fieldsNode.GetArrayLength());
            foreach (var node in fieldsNode.EnumerateArray())
            {
                if (node.ValueKind != JsonValueKind.Object
                    || !node.TryGetProperty("field", out var fieldNode)
                    || !fieldNode.TryGetInt32(out var field)
                    || field < 0)
                    return false;

                string? value = null;
                bool? isChecked = null;
                var hasValue = node.TryGetProperty("value", out var valueNode);
                var hasChecked = node.TryGetProperty("checked", out var checkedNode);
                if (hasValue == hasChecked) return false;

                if (hasValue)
                {
                    if (valueNode.ValueKind != JsonValueKind.String) return false;
                    value = valueNode.GetString() ?? string.Empty;
                    if (value.Length > 16384) return false;
                }
                else
                {
                    if (checkedNode.ValueKind is not JsonValueKind.True and not JsonValueKind.False) return false;
                    isChecked = checkedNode.GetBoolean();
                }
                fields.Add(new BrowserFormValue(field, value, isChecked));
            }

            command = new BrowserCommand(type, Origin: origin, Submit: submit, Fields: fields);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool TryGetString(JsonElement root, string property, out string value)
    {
        value = string.Empty;
        if (!root.TryGetProperty(property, out var node) || node.ValueKind != JsonValueKind.String)
            return false;
        value = node.GetString()?.Trim() ?? string.Empty;
        return value.Length > 0;
    }
}
