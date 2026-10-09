using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Phoenix.Desktop;

/// <summary>Native Windows DPAPI vault for account credentials bound to one HTTPS origin.</summary>
internal sealed class BrowserCredentialVault
{
    private const uint UiForbidden = 0x1;
    private readonly string directory;
    internal sealed record Login(string Account, string Secret);
    private sealed record SavedLogin(int Schema, string Origin, string Account, string Secret);

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob { public int Size; public IntPtr Data; }

    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(
        ref DataBlob input, string? description, IntPtr entropy, IntPtr reserved,
        IntPtr prompt, uint flags, out DataBlob output);

    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(
        ref DataBlob input, IntPtr description, IntPtr entropy, IntPtr reserved,
        IntPtr prompt, uint flags, out DataBlob output);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LocalFree(IntPtr memory);

    internal BrowserCredentialVault(string? root = null)
    {
        directory = root ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Phoenix", "browser-vault");
    }

    private static string Canonical(string origin) =>
        BrowserNavigation.NormalizeCredentialOrigin(origin)
        ?? throw new InvalidOperationException("Browser vault requires a secure origin.");

    private string EntryPath(string origin)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Canonical(origin))));
        return Path.Combine(directory, hash + ".json");
    }

    private static byte[] ApplyDpapi(byte[] bytes, bool decrypt)
    {
        var input = new DataBlob { Size = bytes.Length, Data = Marshal.AllocHGlobal(bytes.Length) };
        var output = new DataBlob();
        try
        {
            Marshal.Copy(bytes, 0, input.Data, bytes.Length);
            var success = decrypt
                ? CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, UiForbidden, out output)
                : CryptProtectData(ref input, "Phoenix origin-bound browser credential",
                    IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, UiForbidden, out output);
            if (!success || output.Data == IntPtr.Zero)
                throw new CryptographicException("Windows could not protect the browser credential.");
            var protectedBytes = new byte[output.Size];
            Marshal.Copy(output.Data, protectedBytes, 0, output.Size);
            return protectedBytes;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
            if (input.Data != IntPtr.Zero)
            {
                Marshal.Copy(new byte[input.Size], 0, input.Data, input.Size);
                Marshal.FreeHGlobal(input.Data);
            }
            if (output.Data != IntPtr.Zero) LocalFree(output.Data);
        }
    }

    private static string Encrypt(string value)
    {
        var encrypted = ApplyDpapi(Encoding.UTF8.GetBytes(value), decrypt: false);
        try { return "dpapi-current-user:v1:" + Convert.ToBase64String(encrypted); }
        finally { CryptographicOperations.ZeroMemory(encrypted); }
    }

    private static string Decrypt(string value)
    {
        const string prefix = "dpapi-current-user:v1:";
        if (!value.StartsWith(prefix, StringComparison.Ordinal))
            throw new InvalidDataException("Browser vault record is not protected.");
        var plaintext = ApplyDpapi(Convert.FromBase64String(value[prefix.Length..]), decrypt: true);
        try { return Encoding.UTF8.GetString(plaintext); }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }

    internal Login? Load(string origin)
    {
        var canonical = Canonical(origin);
        var path = EntryPath(canonical);
        if (!File.Exists(path)) return null;
        try
        {
            var entry = JsonSerializer.Deserialize<SavedLogin>(File.ReadAllText(path));
            if (entry is null || entry.Schema != 1 || entry.Origin != canonical)
                throw new InvalidDataException("Browser vault origin or schema mismatch.");
            return new Login(Decrypt(entry.Account), Decrypt(entry.Secret));
        }
        catch (Exception exception) when (exception is JsonException or FormatException
            or CryptographicException or InvalidDataException)
        {
            throw new InvalidOperationException(
                "Saved browser credentials cannot be decrypted for this Windows user; review this site's vault entry.");
        }
    }

    internal void Save(string origin, string account, string secret)
    {
        var canonical = Canonical(origin);
        if (string.IsNullOrWhiteSpace(account) || string.IsNullOrEmpty(secret)
            || account.Length > 4096 || secret.Length > 16384)
            throw new ArgumentException("Browser account and password must be non-empty and bounded.");
        Directory.CreateDirectory(directory);
        var path = EntryPath(canonical);
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        var record = new SavedLogin(1, canonical, Encrypt(account), Encrypt(secret));
        try
        {
            File.WriteAllText(temp, JsonSerializer.Serialize(record), new UTF8Encoding(false));
            File.Move(temp, path, overwrite: true);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    internal void Delete(string origin) => File.Delete(EntryPath(origin));
}
