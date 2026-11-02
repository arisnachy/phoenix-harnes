using System.IO.Pipes;
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
    internal const int CurrentSchema = 1;
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
    private readonly CancellationTokenSource stopping = new();
    private readonly Task serverTask;
    private bool disposed;

    internal string PipeName { get; }
    internal string DescriptorPath { get; }

    internal DesktopBrowserControlServer(
        Func<BrowserCommand, Task<string?>> dispatch,
        string descriptorPath)
    {
        this.dispatch = dispatch;
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
                using var reader = new StreamReader(pipe, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
                using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
                var line = await reader.ReadLineAsync(stopping.Token);

                if (line is null || !BrowserCommand.TryParse(line, out var command, allowAutomation: true))
                {
                    await writer.WriteLineAsync("{\"ok\":false,\"error\":\"invalid browser command\"}");
                    continue;
                }

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
