using System.Text.Json;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Phoenix.Desktop;

/// <summary>Consent-gated, bounded Windows system-output and microphone capture. Never continuous.</summary>
internal static class DesktopAudioCapture
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly string Folder = Path.Combine(Path.GetTempPath(), "phoenix-audio-captures");

    internal static string Status()
    {
        try
        {
            using var enumerator = new MMDeviceEnumerator();
            string? output = null, microphone = null;
            try
            {
                using var speaker = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                output = speaker.FriendlyName;
            }
            catch (System.Runtime.InteropServices.COMException) { }
            try
            {
                using var mic = enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia);
                microphone = mic.FriendlyName;
            }
            catch (System.Runtime.InteropServices.COMException) { }
            return JsonSerializer.Serialize(new {
                available = output is not null || microphone is not null,
                sources = new {
                    output = new { available = output is not null, device = output },
                    microphone = new { available = microphone is not null, device = microphone }
                },
                requiresConsent = true, listening = Gate.CurrentCount == 0,
                note = "Dispositivos multimedia predeterminados. Requiere permiso visible para CADA captura."
            });
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { available = false, source = "windows-output-loopback",
                requiresConsent = true, reason = ex.GetType().Name });
        }
    }

    internal static async Task<string> CaptureAsync(IWin32Window owner, string sessionId, int seconds, string source = "output")
    {
        if (string.IsNullOrWhiteSpace(sessionId) || seconds is < 3 or > 12
            || source is not "output" and not "microphone")
            throw new InvalidOperationException("AUDIO_CAPTURE_INVALID_REQUEST");
        if (!await Gate.WaitAsync(0))
            throw new InvalidOperationException("AUDIO_CAPTURE_BUSY");

        string? path = null;
        try
        {
            if (MessageBox.Show(owner,
                "Kira solicita grabar " + seconds + " segundos de " +
                (source == "microphone" ? "tu MICROFONO." : "la SALIDA DE WINDOWS.") + "\n\n" +
                (source == "microphone"
                    ? "Se capturara audio del entorno cercano, incluidas conversaciones audibles.\n"
                    : "Puede incluir audio de otras aplicaciones y conversaciones reproducidas.\n") +
                "Solo se activara la fuente seleccionada. Transcripcion local y borrado posterior.\n\n" +
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
            using var device = devices.GetDefaultAudioEndpoint(
                source == "microphone" ? DataFlow.Capture : DataFlow.Render, Role.Multimedia);
            using WasapiCapture recorder = source == "microphone"
                ? new WasapiCapture(device) : new WasapiLoopbackCapture(device);
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
                status = "captured", source = source == "microphone" ? "windows-microphone" : "windows-output-loopback",
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
