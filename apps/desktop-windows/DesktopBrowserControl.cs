using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Phoenix.Desktop;

/// <summary>
/// Discovery record written by Phoenix Desktop so an already-running managed runtime can find
/// the current-user-only named pipe without requiring a runtime restart.
/// </summary>
internal sealed record DesktopBrowserControlDescriptor(
    [property: JsonPropertyName("schema")] int Schema,
    [property: JsonPropertyName("pipeName")] string PipeName)
{
    internal const int CurrentSchema = 2;
    private const string PipePrefix = "PhoenixDesktop.Browser.";

    internal static DesktopBrowserControlDescriptor Create(string pipeName) =>
        new(CurrentSchema, pipeName);

    internal static bool TryParse(string json, out DesktopBrowserControlDescriptor descriptor)
    {
        descriptor = new DesktopBrowserControlDescriptor(0, string.Empty);
        try
        {
            var parsed = JsonSerializer.Deserialize<DesktopBrowserControlDescriptor>(json);
            if (parsed is null
                || parsed.Schema != CurrentSchema
                || !IsValidPipeName(parsed.PipeName))
                return false;
            descriptor = parsed;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    internal static bool IsValidPipeName(string? pipeName)
    {
        if (string.IsNullOrWhiteSpace(pipeName)
            || pipeName.Length > 128
            || !pipeName.StartsWith(PipePrefix, StringComparison.Ordinal))
            return false;

        foreach (var ch in pipeName)
        {
            if (!(char.IsAsciiLetterOrDigit(ch) || ch is '.' or '_' or '-'))
                return false;
        }
        return true;
    }
}

/// <summary>
/// Direct runtime-to-desktop control channel for the embedded WebView2 browser. The pipe is
/// restricted to the current Windows user, while a small descriptor under LocalAppData lets an
/// already-running Phoenix runtime discover the current desktop process.
/// </summary>
internal sealed class DesktopBrowserControlServer : IDisposable
{
    private readonly Func<BrowserCommand, Task<string?>> dispatch;
    private readonly Func<int, bool> clientAuthorizer;
    private readonly CancellationTokenSource stopping = new();
    private readonly Task serverTask;
    private bool disposed;

    internal string PipeName { get; }
    internal string DescriptorPath { get; }

    internal DesktopBrowserControlServer(
        Func<BrowserCommand, Task<string?>> dispatch,
        string descriptorPath,
        Func<int, bool>? clientAuthorizer = null)
    {
        this.dispatch = dispatch;
        this.clientAuthorizer = clientAuthorizer ?? (clientPid => clientPid == Environment.ProcessId);
        DescriptorPath = descriptorPath;
        PipeName = $"PhoenixDesktop.Browser.{Guid.NewGuid():N}";

        WriteDescriptor();
        serverTask = Task.Run(RunAsync);
    }

    private void WriteDescriptor()
    {
        var directory = Path.GetDirectoryName(DescriptorPath);
        if (string.IsNullOrWhiteSpace(directory))
            throw new InvalidOperationException("Desktop browser control descriptor needs a parent directory.");

        Directory.CreateDirectory(directory);
        var descriptor = DesktopBrowserControlDescriptor.Create(PipeName);
        var json = JsonSerializer.Serialize(descriptor);
        var temporary = DescriptorPath + $".{Guid.NewGuid():N}.tmp";
        File.WriteAllText(temporary, json, new UTF8Encoding(false));
        File.Move(temporary, DescriptorPath, overwrite: true);
    }

    private async Task RunAsync()
    {
        while (!stopping.IsCancellationRequested)
        {
            try
            {
                using var pipe = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.InOut,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);

                await pipe.WaitForConnectionAsync(stopping.Token);
                if (!TryGetClientProcessId(pipe, out var clientPid) || !clientAuthorizer(clientPid))
                {
                    DesktopLog.Write($"Rejected unauthorized desktop control pipe client PID {clientPid}.");
                    pipe.Disconnect();
                    continue;
                }
                using var reader = new StreamReader(pipe, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
                using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
                while (!stopping.IsCancellationRequested)
                {
                    var line = await reader.ReadLineAsync(stopping.Token);
                    if (line is null) break;

                    if (DesktopComputerRequest.TryParse(line, out var computerRequest))
                    {
                        await HandleComputerRequestAsync(writer, computerRequest);
                        continue;
                    }

                    // Accept the credential-free schema-1 automation vocabulary only on this
                    // authenticated current-user pipe so adjacent runtime/desktop versions can
                    // survive a rolling update. BrowserCommand still rejects inline credentials;
                    // schema 2 remains the preferred resident protocol.
                    if (BrowserCommand.TryParse(line, out var command, allowAutomation: true))
                    {
                        await HandleLegacyBrowserRequestAsync(writer, command);
                        continue;
                    }

                    await writer.WriteLineAsync("{\"ok\":false,\"error\":\"invalid browser command\"}");
                }
            }
            catch (OperationCanceledException) when (stopping.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                DesktopLog.Write("Desktop browser control pipe failed", ex);
                try
                {
                    await Task.Delay(100, stopping.Token);
                }
                catch (OperationCanceledException) when (stopping.IsCancellationRequested)
                {
                    break;
                }
            }
        }
    }

    private async Task HandleLegacyBrowserRequestAsync(StreamWriter writer, BrowserCommand command)
    {
        try
        {
            var details = await dispatch(command);
            if (details is null)
                await writer.WriteLineAsync("{\"ok\":true}");
            else
                await writer.WriteLineAsync(JsonSerializer.Serialize(new { ok = true, details }));
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Desktop browser control dispatch failed", ex);
            var error = JsonSerializer.Serialize(new { ok = false, error = ex.Message });
            await writer.WriteLineAsync(error);
        }
    }

    private async Task HandleComputerRequestAsync(StreamWriter writer, DesktopComputerRequest request)
    {
        try
        {
            string? details;
            string? screenshot = null;
            if (request.Type.StartsWith("browser_", StringComparison.Ordinal))
            {
                details = await DispatchBrowserRequestAsync(request);
                if (request.Capture && request.Type is not ("browser_login" or "browser_forget_credentials"))
                    screenshot = DesktopComputerDriver.CaptureScreenshot();
            }
            else
            {
                var result = DesktopComputerDriver.Execute(request);
                details = result.Details;
                screenshot = result.ScreenshotBase64;
            }

            await writer.WriteLineAsync(JsonSerializer.Serialize(new
            {
                schema = DesktopComputerRequest.CurrentSchema,
                requestId = request.RequestId,
                ok = true,
                details,
                screenshotBase64 = screenshot,
            }));
        }
        catch (Exception ex)
        {
            if (request.Type == "browser_login")
                DesktopLog.Write("Resident desktop credential fill failed.");
            else
                DesktopLog.Write("Resident desktop Computer dispatch failed", ex);
            await writer.WriteLineAsync(JsonSerializer.Serialize(new
            {
                schema = DesktopComputerRequest.CurrentSchema,
                requestId = request.RequestId,
                ok = false,
                error = request.Type == "browser_login" ? "Credential fill failed." : ex.Message,
            }));
        }
    }

    internal static bool IsAllowedClient(int clientPid, int runtimePid) =>
        clientPid > 0
        && runtimePid > 0
        && DesktopRuntimeProcessIdentity.IsSameOrDescendantOf(clientPid, runtimePid);

    private static bool TryGetClientProcessId(NamedPipeServerStream pipe, out int processId)
    {
        processId = 0;
        if (!OperatingSystem.IsWindows()
            || !GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(), out var rawProcessId)
            || rawProcessId > int.MaxValue)
            return false;
        processId = (int)rawProcessId;
        return processId > 0;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNamedPipeClientProcessId(nint pipe, out uint processId);

    private async Task<string?> DispatchBrowserRequestAsync(DesktopComputerRequest request)
    {
        return request.Type switch
        {
            "browser_open" => await dispatch(new BrowserCommand("phoenix.browser.open", Url: request.Url)),
            "browser_close" => await dispatch(new BrowserCommand("phoenix.browser.close")),
            "browser_back" => await dispatch(new BrowserCommand("phoenix.browser.back")),
            "browser_forward" => await dispatch(new BrowserCommand("phoenix.browser.forward")),
            "browser_reload" => await dispatch(new BrowserCommand("phoenix.browser.reload")),
            "browser_focus" => await dispatch(new BrowserCommand("phoenix.browser.focus")),
            "browser_inspect" => await dispatch(new BrowserCommand("phoenix.browser.inspect")),
            "browser_fill_form" => await dispatch(new BrowserCommand(
                "phoenix.browser.fill-form",
                Origin: request.Origin,
                Submit: request.Submit,
                Fields: request.Fields)),
            "browser_click_text" => await dispatch(new BrowserCommand(
                "phoenix.browser.click-text",
                Origin: request.Origin,
                Text: request.Text)),
            "browser_login" => await dispatch(new BrowserCommand(
                "phoenix.browser.login",
                Origin: request.Origin)),
            "browser_forget_credentials" => await dispatch(new BrowserCommand(
                "phoenix.browser.forget-credentials",
                Origin: request.Origin)),
            _ => throw new InvalidOperationException($"Unsupported resident browser action: {request.Type}"),
        };
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        stopping.Cancel();
        try { serverTask.Wait(TimeSpan.FromSeconds(1)); } catch { }

        try
        {
            if (File.Exists(DescriptorPath))
            {
                var raw = File.ReadAllText(DescriptorPath);
                if (DesktopBrowserControlDescriptor.TryParse(raw, out var descriptor)
                    && string.Equals(descriptor.PipeName, PipeName, StringComparison.Ordinal))
                    File.Delete(DescriptorPath);
            }
        }
        catch (Exception ex)
        {
            DesktopLog.Write("Desktop browser control descriptor cleanup failed", ex);
        }

        stopping.Dispose();
    }
}
