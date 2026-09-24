# Install 6 Degrees on Windows with one line. In PowerShell:
#
#   irm https://raw.githubusercontent.com/blakeb056/six-degrees/main/install.ps1 | iex
#
# What it does, in order — nothing else:
#   1. finds the newest release on GitHub
#   2. downloads the Windows build and checks it against the published SHA-256
#   3. unpacks it into %LOCALAPPDATA%\Programs\Six Degrees (no admin rights needed)
#   4. adds Start Menu shortcuts (Six Degrees, Stop Six Degrees) and a Desktop one
#   5. opens it
#
# Node is bundled, so nothing else is needed to run it. The scanner also needs
# Python and Google Chrome; the app's Scan page checks for both.
#
# Your data is never touched: it lives in %USERPROFILE%\.six-degrees, not in the
# app, so running this again later is also how you update.
#
# Options (environment variables, set before running):
#   $env:SIX_DEGREES_VERSION = '0.2.0'   install a specific release instead of the newest
#   $env:SIX_DEGREES_DEST = 'D:\Apps\Six Degrees'   install somewhere else
#   $env:SIX_DEGREES_NO_OPEN = '1'       do not open the app afterwards
#   $env:SIX_DEGREES_NO_DESKTOP = '1'    no Desktop shortcut
#   $env:SIX_DEGREES_ZIP = '.\x.zip'     install a zip you already have (skips the download)

# Everything runs inside Install-SixDegrees, called on the last line. If the
# download of this script is cut short, that line never arrives and nothing
# runs — a half-received installer must not half-install.

function Install-SixDegrees {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads ~10x slower in PowerShell 5
  $repo = 'blakeb056/six-degrees'

  function Say([string]$m) { Write-Host "  $m" }
  function Fail([string]$m) { Write-Host ''; Write-Host "  x $m" -ForegroundColor Red; Write-Host ''; throw $m }

  Write-Host ''
  Write-Host '  6 Degrees - installer'
  Write-Host ''

  if ($env:OS -ne 'Windows_NT') { Fail 'This installer is for Windows. On a Mac use install.sh; anywhere with Node 22.13+: npx six-degrees@latest' }
  # PowerShell 5 on older Windows may not offer TLS 1.2 to GitHub by default.
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

  $arch = $env:PROCESSOR_ARCHITECTURE
  if ($arch -eq 'ARM64') { Say 'Windows:  Arm (the x64 build runs through Windows'' built-in emulation)' }
  elseif ($arch -eq 'AMD64') { Say 'Windows:  x64' }
  else { Fail "Six Degrees needs 64-bit Windows (this is $arch)." }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('sd-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    # ---- get the zip --------------------------------------------------------
    if ($env:SIX_DEGREES_ZIP) {
      if (-not (Test-Path $env:SIX_DEGREES_ZIP)) { Fail "No file at $env:SIX_DEGREES_ZIP" }
      $zip = Join-Path $tmp (Split-Path $env:SIX_DEGREES_ZIP -Leaf)
      Copy-Item $env:SIX_DEGREES_ZIP $zip
      Say "Local:    $(Split-Path $zip -Leaf) (your own file, so no checksum to check)"
    } else {
      $api = if ($env:SIX_DEGREES_VERSION) {
        "https://api.github.com/repos/$repo/releases/tags/v$($env:SIX_DEGREES_VERSION.TrimStart('v'))"
      } else { "https://api.github.com/repos/$repo/releases/latest" }
      try { $release = Invoke-RestMethod -Uri $api -Headers @{ Accept = 'application/vnd.github+json' } }
      catch { Fail "Could not find a release on GitHub. Check your connection, or see https://github.com/$repo/releases" }

      # Asset names are fixed by scripts/build-windows.mjs: Six-Degrees-<version>-win-x64.zip
      $asset = $release.assets | Where-Object { $_.name -like '*-win-x64.zip' } | Select-Object -First 1
      $sums = $release.assets | Where-Object { $_.name -eq 'SHA256SUMS' } | Select-Object -First 1
      if (-not $asset) { Fail "That release has no Windows download. See https://github.com/$repo/releases" }

      $zip = Join-Path $tmp $asset.name
      Say "Release:  $($asset.name)"
      Say 'Downloading...'
      try { Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing }
      catch { Fail 'The download failed. Try again.' }

      if ($sums) {
        $sumsFile = Join-Path $tmp 'SHA256SUMS'
        Invoke-WebRequest -Uri $sums.browser_download_url -OutFile $sumsFile -UseBasicParsing
        $line = Get-Content $sumsFile | Where-Object { $_ -match "\s\*?$([regex]::Escape($asset.name))$" } | Select-Object -First 1
        if (-not $line) { Fail "The checksum file does not list $($asset.name)." }
        $want = ($line -split '\s+')[0].ToLower()
        $got = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
        if ($want -ne $got) { Fail 'Checksum mismatch - the download is not what was published. Nothing was installed.' }
        Say 'Verified: SHA-256 matches the release'
      } else {
        Say 'Note:     this release has no checksum file, so the download was not verified'
      }
    }

    # ---- unpack -------------------------------------------------------------
    $dest = if ($env:SIX_DEGREES_DEST) { $env:SIX_DEGREES_DEST } else { Join-Path $env:LOCALAPPDATA 'Programs\Six Degrees' }
    $staged = Join-Path $tmp 'unpacked'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $staged)
    if (-not (Test-Path (Join-Path $staged 'launch.ps1')) -or -not (Test-Path (Join-Path $staged 'node.exe'))) {
      Fail 'The download does not look like a Six Degrees build. Nothing was installed.'
    }

    # ---- stop a running copy, then swap it in -------------------------------
    # A running copy would keep serving the old version (and hold its files).
    $oldNode = Join-Path $dest 'node.exe'
    $running = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -ieq $oldNode } catch { $false } }
    if ($running) {
      Say 'Stopping the running copy so it can be replaced...'
      $running | Stop-Process -Force
      $running | ForEach-Object { try { $_.WaitForExit(10000) | Out-Null } catch {} }
    }
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
    # Move is instant on the same drive; a different drive needs a copy.
    try { Move-Item $staged $dest } catch { Copy-Item -Recurse $staged $dest }
    Get-ChildItem -Path $dest -Filter *.ps1 | Unblock-File -ErrorAction SilentlyContinue
    Unblock-File -Path (Join-Path $dest 'node.exe') -ErrorAction SilentlyContinue

    # ---- shortcuts ------------------------------------------------------------
    $shell = New-Object -ComObject WScript.Shell
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    function New-Shortcut([string]$path, [string]$launchArgs, [string]$description) {
      $s = $shell.CreateShortcut($path)
      $s.TargetPath = $ps
      $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $dest 'launch.ps1')`" $launchArgs".Trim()
      $s.WorkingDirectory = $dest
      $s.IconLocation = Join-Path $dest 'six-degrees.ico'
      $s.WindowStyle = 7   # minimised: no console flashing up
      $s.Description = $description
      $s.Save()
    }
    $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Six Degrees'
    New-Item -ItemType Directory -Path $menu -Force | Out-Null
    New-Shortcut (Join-Path $menu 'Six Degrees.lnk') '' 'Open Six Degrees'
    New-Shortcut (Join-Path $menu 'Stop Six Degrees.lnk') '-Stop' 'Stop Six Degrees running in the background'
    if (-not $env:SIX_DEGREES_NO_DESKTOP) {
      New-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Six Degrees.lnk') '' 'Open Six Degrees'
    }

    Say "Installed: $dest"
    Say "Your data: $(Join-Path $env:USERPROFILE '.six-degrees') (unchanged)"

    if (-not $env:SIX_DEGREES_NO_OPEN) {
      & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dest 'launch.ps1')
      Write-Host ''
      Write-Host '  Opening 6 Degrees. Next time, open it from the Start Menu or the Desktop.' -ForegroundColor Green
    } else {
      Write-Host ''
      Write-Host '  Done.' -ForegroundColor Green
    }
    Write-Host '    To update later, run the same command again.'
    Write-Host ''
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}

Install-SixDegrees
