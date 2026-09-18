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

    /// <summary>
    /// Keep the browser useful without letting it dominate the conversation:
    /// roughly 26% of the window, clamped to a compact desktop-friendly range.
    /// </summary>
    public static int PreferredBrowserWidth(int clientWidth)
    {
        var proportional = (int)Math.Round(Math.Max(0, clientWidth) * 0.26d);
        return Math.Clamp(proportional, 360, 520);
    }
}

/// <summary>Typed command accepted from the Phoenix WebView through window.chrome.webview.postMessage.</summary>
public sealed record BrowserCommand(string Type, string? Url)
{
    private static readonly HashSet<string> AllowedTypes = new(StringComparer.Ordinal)
    {
        "phoenix.browser.open",
        "phoenix.browser.close",
        "phoenix.browser.back",
        "phoenix.browser.forward",
        "phoenix.browser.reload",
        "phoenix.browser.home",
        "phoenix.browser.focus",
    };

    public static bool TryParse(string json, out BrowserCommand command)
    {
        command = new BrowserCommand(string.Empty, null);
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return false;
            if (!doc.RootElement.TryGetProperty("type", out var typeNode)) return false;
            var type = typeNode.GetString();
            if (type is null || !AllowedTypes.Contains(type)) return false;

            string? url = null;
            if (type == "phoenix.browser.open")
            {
                if (!doc.RootElement.TryGetProperty("url", out var urlNode)) return false;
                url = urlNode.GetString()?.Trim();
                if (BrowserNavigation.NormalizeAddress(url) is null) return false;
            }

            command = new BrowserCommand(type, url);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
