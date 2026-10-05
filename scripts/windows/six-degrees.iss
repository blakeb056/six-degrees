; Sixgree (formerly Six Degrees) for Windows: a one-click, per-user Setup.exe (docs/brain/DESKTOP.md D3).
; Built by scripts/build-desktop.mjs --platform=win32, which passes the /D values:
;   AppVersion, NumericVersion (x.y.z.0), SourceDir (the packaged app), OutputDir, IconFile.
;
; Installs for this user only (no admin prompt) into
; %LOCALAPPDATA%\Programs\Six Degrees, adds Start Menu and Desktop shortcuts,
; and opens the app. Running a newer Setup.exe over it updates it: it closes a
; running copy the way Exit does (the scan stops cleanly, its Chrome closes),
; replaces the app and opens it again. The network in %USERPROFILE%\.six-degrees
; is never touched, by installing, updating or uninstalling (DESKTOP.md rule 3).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef NumericVersion
  #define NumericVersion "0.0.0.0"
#endif

[Setup]
; Fixed for good: Windows knows the installed app by it, so a newer Setup.exe updates it.
AppId={{010929DA-B1D1-47A6-B6C8-BE7CC9ACA2C5}
AppName=Sixgree
AppVersion={#AppVersion}
AppVerName=Sixgree {#AppVersion}
VersionInfoVersion={#NumericVersion}
AppPublisher=Sixgree
AppPublisherURL=https://sixgree.com
AppSupportURL=https://github.com/blakeb056/six-degrees
DefaultDirName={localappdata}\Programs\Six Degrees
PrivilegesRequired=lowest
DisableWelcomePage=yes
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableFinishedPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Windows 10 1809 or later (Electron's own minimum is Windows 10).
MinVersion=10.0.17763
OutputDir={#OutputDir}
OutputBaseFilename=Sixgree-{#AppVersion}-win-x64-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Six Degrees.exe
UninstallDisplayName=Sixgree
Compression=lzma2/max
SolidCompression=yes
LZMAUseSeparateProcess=yes
CloseApplications=yes
RestartApplications=no
UsedUserAreasWarning=no
SetupLogging=yes
WizardStyle=modern

[InstallDelete]
; The previous version's files, so nothing of it lingers beside the new one. Only
; the app's own folder: never the data folder.
Type: filesandordirs; Name: "{app}\resources"
Type: filesandordirs; Name: "{app}\locales"
; The shortcuts from before the rename to Sixgree, which [Icons] no longer makes.
Type: files; Name: "{autoprograms}\Six Degrees.lnk"
Type: files; Name: "{autodesktop}\Six Degrees.lnk"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Sixgree"; Filename: "{app}\Six Degrees.exe"; AppUserModelID: "com.blakeburford.sixdegrees"
Name: "{autodesktop}\Sixgree"; Filename: "{app}\Six Degrees.exe"; AppUserModelID: "com.blakeburford.sixdegrees"

[Run]
; One click: a progress bar, then the app opens (not when installed silently, as CI does).
Filename: "{app}\Six Degrees.exe"; Flags: nowait skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/IM ""Six Degrees.exe"""; Flags: runhidden; RunOnceId: "CloseSixDegrees"

[Code]
// Is Sixgree running for this user? tasklist's list, searched by find: 0 when it is.
function SixDegreesRunning(): Boolean;
var
  Code: Integer;
begin
  Result := Exec(ExpandConstant('{cmd}'), '/C tasklist /FI "IMAGENAME eq Six Degrees.exe" /FI "USERNAME eq %USERNAME%" | find /I "Six Degrees.exe" >NUL',
    '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;

// Before replacing a running copy: ask it to close, as Exit does (taskkill
// without /F sends its window WM_CLOSE: the app stops a scan cleanly, then its
// server), and wait up to 30 seconds for it to go.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code, I: Integer;
begin
  Result := '';
  if not SixDegreesRunning() then Exit;
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM "Six Degrees.exe"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  for I := 1 to 60 do
  begin
    if not SixDegreesRunning() then Exit;
    Sleep(500);
  end;
  Result := 'Sixgree is still open. Close it (File, then Exit), then run Setup again.';
end;
