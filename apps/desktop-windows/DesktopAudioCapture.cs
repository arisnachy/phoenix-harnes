using System.Text.Json;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Phoenix.Desktop;

/// <summary>Consent-gated, bounded Windows system-output capture. No microphone or continuous spying.</summary>
internal static class DesktopAudioCapture
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly string Folder = Path.Combine(Path.GetTempPath(), "phoenix-audio-captures");

    internal static string Status()
    {
        try
        {
            using var enumerator = new MMDeviceEnumerator();
            using var device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            return JsonSerializer.Serialize(new {
                available = true, source = "windows-output-loopback", device = device.FriendlyName,
                requiresConsent = true, listening = Gate.CurrentCount == 0,
                note = "Solo salida predeterminada de Windows; no microfono ni otras salidas."
            });
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { available = false, source = "windows-output-loopback",
                requiresConsent = true, reason = ex.GetType().Name });
        }
    }

    internal static async Task<string> CaptureAsync(IWin32Window owner, string sessionId, int seconds)
    {
        if (string.IsNullOrWhiteSpace(sessionId) || seconds is < 3 or > 12)
            throw new InvalidOperationException("AUDIO_CAPTURE_INVALID_REQUEST");
        if (!await Gate.WaitAsync(0))
            throw new InvalidOperationException("AUDIO_CAPTURE_BUSY");

        string? path = null;
        try
        {
            if (MessageBox.Show(owner,
                "Kira solicita escuchar " + seconds + " segundos de la salida de Windows.\n\n" +
                "Esto puede incluir audio de otras aplicaciones o conversaciones reproducidas.\n" +
                "No activa el microfono. La grabacion se transcribe localmente y se elimina.\n\n" +
                "¿Autorizar esta captura?",
                "PHOENIX · Oído universal", MessageBoxButtons.YesNo,
                MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
                throw new InvalidOperationException("AUDIO_CAPTURE_CONSENT_DENIED");

            Directory.CreateDirectory(Folder);
            foreach (var old in Directory.EnumerateFiles(Folder, "audio-*.wav"))
            {
                try
                {
                    if (DateTime.UtcNow - File.GetLastWriteTimeUtc(old) > TimeSpan.FromMinutes(30))
                        File.Delete(old);
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            path = Path.Combine(Folder, "audio-" + Guid.NewGuid().ToString("N") + ".wav");
            using var devices = new MMDeviceEnumerator();
            using var device = devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            using var recorder = new WasapiLoopbackCapture(device);
            using var writer = new WaveFileWriter(path, recorder.WaveFormat);
            var stopped = new TaskCompletionSource<Exception?>(TaskCreationOptions.RunContinuationsAsynchronously);
            long bytes = 0;
            recorder.DataAvailable += (_, data) =>
            {
                if (data.BytesRecorded <= 0) return;
                writer.Write(data.Buffer, 0, data.BytesRecorded);
                Interlocked.Add(ref bytes, data.BytesRecorded);
            };
            recorder.RecordingStopped += (_, args) => stopped.TrySetResult(args.Exception);
            var started = false;
            try
            {
                recorder.StartRecording();
                started = true;
                await Task.Delay(TimeSpan.FromSeconds(seconds));
            }
            finally
            {
                if (started) recorder.StopRecording();
            }
            var error = await stopped.Task.WaitAsync(TimeSpan.FromSeconds(6));
            if (error is not null) throw new InvalidOperationException("AUDIO_CAPTURE_DEVICE_FAILED", error);
            writer.Flush();
            if (Interlocked.Read(ref bytes) < 512)
                throw new InvalidOperationException("AUDIO_CAPTURE_SILENCE: no se recibieron muestras; reproduce audio y comprueba el dispositivo.");
            return JsonSerializer.Serialize(new {
                status = "captured", source = "windows-output-loopback",
                file = path, bytes = Interlocked.Read(ref bytes), seconds, sessionId,
                device = device.FriendlyName
            });
        }
        catch
        {
            if (path is not null) try { File.Delete(path); } catch (IOException) { }
            throw;
        }
        finally { Gate.Release(); }
    }
}
