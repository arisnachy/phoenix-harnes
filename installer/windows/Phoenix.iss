#ifndef SourceDir
  #define SourceDir "..\..\dist\phoenix-desktop"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\dist\installer"
#endif

[Setup]
AppId={{B4E91D88-7B14-4DA0-A63D-4E61B648AE1F}
AppName=Phoenix
AppVersion=1.0.0
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

[Files]
Source: "{#SourceDir}\Phoenix.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\bootstrap-runtime.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; GroupDescription: "Accesos directos:"; Flags: checkedonce
Name: "autostart"; Description: "Iniciar Phoenix con Windows"; GroupDescription: "Inicio:"; Flags: checkedonce

[Icons]
Name: "{group}\Phoenix"; Filename: "{app}\Phoenix.exe"
Name: "{autodesktop}\Phoenix"; Filename: "{app}\Phoenix.exe"; Tasks: desktopicon

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\bootstrap-runtime.ps1"""; StatusMsg: "Preparando runtime administrado de Phoenix..."; Flags: runhidden waituntilterminated
Filename: "{app}\Phoenix.exe"; Parameters: "--enable-autostart"; Flags: runhidden waituntilterminated; Tasks: autostart
Filename: "{app}\Phoenix.exe"; Description: "Abrir Phoenix"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Phoenix.exe"; Parameters: "--disable-autostart"; Flags: runhidden waituntilterminated skipifdoesntexist

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;
