using System.Runtime.InteropServices;
using System.Security;
using System.Security.Cryptography;
using System.Text;

namespace Phoenix.CredentialBroker;

/// <summary>
/// Stores remembered credentials in the current user's Windows Credential Manager and keeps
/// one-use credentials only in this broker process. Credential Manager is user-scoped storage;
/// this process does not claim isolation from another process with the same user permissions.
/// </summary>
internal sealed class CredentialVaultStore
{
    private const uint CredentialTypeGeneric = 1;
    private const uint CredentialPersistLocalMachine = 2;
    private const int ErrorNotFound = 1168;
    private const int MaximumCredentialBlobBytes = 512;
    private const int MaximumTargetPrefixLength = 200;
    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    private readonly string targetPrefix;
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly Dictionary<string, VaultEntry> transient = new(StringComparer.Ordinal);

    internal CredentialVaultStore(string targetPrefix)
    {
        if (string.IsNullOrWhiteSpace(targetPrefix) || targetPrefix.Length > MaximumTargetPrefixLength)
            throw new ArgumentException("The credential target prefix is invalid.", nameof(targetPrefix));
        this.targetPrefix = targetPrefix;
    }

    internal async Task StoreAsync(string origin, string account, string secret, bool remember, CancellationToken cancellationToken)
    {
        ValidateCredential(origin, account, secret);
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var value = new VaultEntry(account, secret);
            if (!remember)
            {
                transient[origin] = value;
                return;
            }

            WriteCredential(origin, value);
            transient.Remove(origin);
        }
        finally
        {
            gate.Release();
        }
    }

    internal async Task<bool> HasAsync(string origin, CancellationToken cancellationToken)
    {
        ValidateOrigin(origin);
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (transient.ContainsKey(origin))
                return true;
            return ReadCredential(origin) is not null;
        }
        finally
        {
            gate.Release();
        }
    }

    internal async Task<(string Account, string Secret)?> FillOnceAsync(string origin, CancellationToken cancellationToken)
    {
        ValidateOrigin(origin);
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (transient.Remove(origin, out var temporary))
                return (temporary.Account, temporary.Secret);

            var value = ReadCredential(origin);
            return value is null ? null : (value.Account, value.Secret);
        }
        finally
        {
            gate.Release();
        }
    }

    internal async Task ForgetAsync(string origin, CancellationToken cancellationToken)
    {
        ValidateOrigin(origin);
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            transient.Remove(origin);
            DeleteCredential(origin);
        }
        finally
        {
            gate.Release();
        }
    }

    private void WriteCredential(string origin, VaultEntry value)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Windows Credential Manager is required.");

        var secretBytes = StrictUtf8.GetBytes(value.Secret);
        if (secretBytes.Length > MaximumCredentialBlobBytes)
            throw new ArgumentException("The secret exceeds the Windows Credential Manager limit.", nameof(value));

        var target = TargetFor(origin);
        var targetPointer = Marshal.StringToCoTaskMemUni(target);
        var accountPointer = Marshal.StringToCoTaskMemUni(value.Account);
        var secretPointer = IntPtr.Zero;
        try
        {
            if (secretBytes.Length > 0)
            {
                secretPointer = Marshal.AllocCoTaskMem(secretBytes.Length);
                Marshal.Copy(secretBytes, 0, secretPointer, secretBytes.Length);
            }

            var credential = new NativeCredential
            {
                Type = CredentialTypeGeneric,
                TargetName = targetPointer,
                CredentialBlobSize = checked((uint)secretBytes.Length),
                CredentialBlob = secretPointer,
                Persist = CredentialPersistLocalMachine,
                UserName = accountPointer,
            };
            if (!CredWriteW(ref credential, 0))
                throw CredentialManagerFailure("write");
        }
        finally
        {
            if (secretPointer != IntPtr.Zero)
                ZeroUnmanaged(secretPointer, secretBytes.Length);
            CryptographicOperations.ZeroMemory(secretBytes);
            if (secretPointer != IntPtr.Zero)
                Marshal.FreeCoTaskMem(secretPointer);
            Marshal.FreeCoTaskMem(accountPointer);
            Marshal.FreeCoTaskMem(targetPointer);
        }
    }

    private VaultEntry? ReadCredential(string origin)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Windows Credential Manager is required.");

        var target = TargetFor(origin);
        var targetPointer = Marshal.StringToCoTaskMemUni(target);
        IntPtr credentialPointer = IntPtr.Zero;
        try
        {
            if (!CredReadW(targetPointer, CredentialTypeGeneric, 0, out credentialPointer))
            {
                var error = Marshal.GetLastWin32Error();
                if (error == ErrorNotFound)
                    return null;
                throw CredentialManagerFailure("read", error);
            }

            var credential = Marshal.PtrToStructure<NativeCredential>(credentialPointer);
            if (credential.Type != CredentialTypeGeneric
                || credential.TargetName == IntPtr.Zero
                || !string.Equals(Marshal.PtrToStringUni(credential.TargetName), target, StringComparison.Ordinal)
                || credential.UserName == IntPtr.Zero
                || credential.CredentialBlobSize > MaximumCredentialBlobBytes
                || (credential.CredentialBlobSize > 0 && credential.CredentialBlob == IntPtr.Zero))
                throw new InvalidDataException("Windows returned an invalid generic credential.");

            var account = Marshal.PtrToStringUni(credential.UserName);
            if (account is null || !IsBounded(account, 1024))
                throw new InvalidDataException("Windows returned an invalid generic credential.");

            var secretBytes = new byte[checked((int)credential.CredentialBlobSize)];
            try
            {
                if (secretBytes.Length > 0)
                    Marshal.Copy(credential.CredentialBlob, secretBytes, 0, secretBytes.Length);
                var secret = StrictUtf8.GetString(secretBytes);
                if (!IsBounded(secret, 4096))
                    throw new InvalidDataException("Windows returned an invalid generic credential.");
                return new VaultEntry(account, secret);
            }
            finally
            {
                if (credential.CredentialBlob != IntPtr.Zero && secretBytes.Length > 0)
                    ZeroUnmanaged(credential.CredentialBlob, secretBytes.Length);
                CryptographicOperations.ZeroMemory(secretBytes);
            }
        }
        finally
        {
            if (credentialPointer != IntPtr.Zero)
                CredFree(credentialPointer);
            Marshal.FreeCoTaskMem(targetPointer);
        }
    }

    private void DeleteCredential(string origin)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Windows Credential Manager is required.");

        var targetPointer = Marshal.StringToCoTaskMemUni(TargetFor(origin));
        try
        {
            if (CredDeleteW(targetPointer, CredentialTypeGeneric, 0))
                return;

            var error = Marshal.GetLastWin32Error();
            if (error != ErrorNotFound)
                throw CredentialManagerFailure("delete", error);
        }
        finally
        {
            Marshal.FreeCoTaskMem(targetPointer);
        }
    }

    private string TargetFor(string origin) =>
        $"{targetPrefix}.{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(origin)))}";

    private static void ValidateCredential(string origin, string account, string secret)
    {
        ValidateOrigin(origin);
        if (!IsBounded(account, 1024) || !IsBounded(secret, 4096))
            throw new ArgumentException("The credential value is invalid.");
    }

    private static void ValidateOrigin(string origin)
    {
        if (!IsCanonicalOrigin(origin))
            throw new ArgumentException("The credential origin is invalid.", nameof(origin));
    }

    private static bool IsCanonicalOrigin(string origin) =>
        BrokerOrigin.Normalize(origin) is { } canonical
        && string.Equals(canonical, origin, StringComparison.Ordinal);

    private static bool IsBounded(string value, int maxLength) =>
        value is not null && value.Length <= maxLength && !value.Contains('\0');

    private static SecurityException CredentialManagerFailure(string operation, int? error = null)
    {
        var code = error ?? Marshal.GetLastWin32Error();
        return new SecurityException($"Windows Credential Manager {operation} failed with Win32 code 0x{code:X8}.");
    }

    private static void ZeroUnmanaged(IntPtr pointer, int length)
    {
        if (length <= 0)
            return;
        var zeros = new byte[length];
        try
        {
            Marshal.Copy(zeros, 0, pointer, length);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(zeros);
        }
    }

    private sealed record VaultEntry(string Account, string Secret)
    {
        public override string ToString() => "VaultEntry { Account=<redacted>, Secret=<redacted> }";
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NativeCredential
    {
        internal uint Flags;
        internal uint Type;
        internal IntPtr TargetName;
        internal IntPtr Comment;
        internal System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        internal uint CredentialBlobSize;
        internal IntPtr CredentialBlob;
        internal uint Persist;
        internal uint AttributeCount;
        internal IntPtr Attributes;
        internal IntPtr TargetAlias;
        internal IntPtr UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWriteW(ref NativeCredential credential, uint flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredReadW(IntPtr targetName, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDeleteW(IntPtr targetName, uint type, uint flags);

    [DllImport("advapi32.dll", SetLastError = false)]
    private static extern void CredFree(IntPtr credential);
}
