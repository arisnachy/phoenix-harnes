#ifndef SourceDir
  #define SourceDir "..\..\dist\phoenix-desktop"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\dist\installer"
#endif

[Setup]
AppId={{B4E91D88-7B14-4DA0-A63D-4E61B648AE1F}
AppName=Phoenix
AppVersion=1.0.22
AppPublisher=Phoenix AI
DefaultDirName={localappdata}\Programs\Phoenix
DefaultGroupName=Phoenix
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=Phoenix-Windows-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\Phoenix.exe
SetupIconFile={#SourceDir}\phoenix.ico
; Phoenix is a tray application and intentionally cancels normal user closes by hiding.
; During an upgrade that graceful close leaves Phoenix.exe/WebView2Loader.dll locked,
; so Restart Manager must force-close the process before replacing the desktop payload.
CloseApplications=force
RestartApplications=no

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; GroupDescription: "Accesos directos:"; Flags: checkedonce
Name: "autostart"; Description: "Iniciar Phoenix con Windows"; GroupDescription: "Inicio:"; Flags: checkedonce

[Icons]
Name: "{group}\Phoenix"; Filename: "{app}\Phoenix.exe"
Name: "{autodesktop}\Phoenix"; Filename: "{app}\Phoenix.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Phoenix AI\Phoenix"; ValueType: string; ValueName: "InstallLocation"; ValueData: "{app}"; Flags: uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\Phoenix AI\Phoenix"; ValueType: string; ValueName: "ExecutablePath"; ValueData: "{app}\Phoenix.exe"; Flags: uninsdeletekeyifempty

[Run]
; Pre-warm the immutable runtime during installation so the first interactive EXE launch does not
; spend its critical path expanding hundreds of MB. This is native Phoenix.exe work: no PowerShell.
Filename: "{app}\Phoenix.exe"; Parameters: "--prepare-runtime"; Flags: runhidden waituntilterminated skipifsilent
; Pre-warm the dedicated Phoenix WebView2 shell profile during installation. This keeps the first
; interactive double-click out of Chromium's cold profile-creation path.
Filename: "{app}\Phoenix.exe"; Parameters: "--prepare-webview"; Flags: runhidden waituntilterminated skipifsilent
; Runtime ownership belongs to Phoenix.exe; Node.js, Corepack and MinGit are bundled.
Filename: "{app}\Phoenix.exe"; Parameters: "--enable-autostart"; Flags: runhidden waituntilterminated skipifsilent; Tasks: autostart
Filename: "{app}\Phoenix.exe"; Description: "Abrir Phoenix"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Phoenix.exe"; Parameters: "--disable-autostart"; Flags: runhidden waituntilterminated skipifdoesntexist

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  { Phoenix intentionally hides to tray on a normal close. During upgrades, guarantee that }
  { the old native shell and its Node child tree are gone before replacing the payload, so }
  { the post-install launch cannot signal a stale single-instance mutex owner. }
  Exec(
    ExpandConstant('{sys}\taskkill.exe'),
    '/IM "Phoenix.exe" /T /F',
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode);
  Sleep(300);
  Result := '';
end;
