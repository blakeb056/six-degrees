# Six Degrees for Windows: start the app and open its window.
#
# The Start Menu and Desktop shortcuts run this (install.ps1 makes them). It is
# the Windows counterpart of the Mac app's launcher in scripts/build-app.mjs:
#   1. if Six Degrees is already running, just open another window on it;
#   2. otherwise start the bundled Node server hidden, on 127.0.0.1 only;
#   3. wait until it answers, then open it as an app window (Chrome or Edge
#      with --app: no address bar, no tabs), or the default browser.
# The server keeps running after the window closes, like a menu-bar app. The
# "Stop Six Degrees" shortcut runs this with -Stop.
#
#   -Stop     stop the running copy
#   -NoOpen   start (or find) the server but open no window; prints the address

param([switch]$Stop, [switch]$NoOpen)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $here 'node.exe'

# Every node.exe started from this folder is ours; nothing else is touched.
function Get-OurServers {
  Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -and ($_.Path -ieq $node) } catch { $false }
  }
}

if ($Stop) {
  Get-OurServers | Stop-Process -Force -ErrorAction SilentlyContinue
  exit 0
}

# Is a Six Degrees answering on this port? (Another program may hold it.)
function Test-OurApp([int]$port) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -eq 200 -and $r.Content -match '6 Degrees'
  } catch { return $false }
}

function Test-PortFree([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { $client.Connect('127.0.0.1', $port); return $false }
  catch { return $true }
  finally { $client.Close() }
}

$port = $null
if (Get-OurServers) {
  foreach ($p in 6363..6399) { if (Test-OurApp $p) { $port = $p; break } }
}

if (-not $port) {
  # Walk up from 6363 past anything else listening, like the Mac launcher.
  foreach ($p in 6363..6399) { if (Test-PortFree $p) { $port = $p; break } }
  if (-not $port) { throw 'No free port between 6363 and 6399.' }

  $env:SIX_DEGREES_BIND = '127.0.0.1'
  $env:HOSTNAME = '127.0.0.1'
  $env:PORT = "$port"
  $env:NEXT_TELEMETRY_DISABLED = '1'
  $env:SIX_DEGREES_ROOT = Join-Path $here 'app'
  $env:SIX_DEGREES_INSTALL = 'win-app'

  $log = Join-Path $env:TEMP 'six-degrees.log'
  # Through cmd.exe, with the redirect done by cmd rather than -RedirectStandard*.
  # Asking Start-Process to redirect makes Windows hand the server every
  # inheritable handle this launcher has, including whatever pipe is reading the
  # launcher's output, so a caller waiting for that output waits for the
  # server to exit, which is never. Without -Redirect*, Start-Process uses the
  # shell and nothing is inherited. $server is the cmd.exe, alive while node is.
  $serverJs = Join-Path $here 'app\server.js'
  $cmdLine = '/d /c ""' + $node + '" "' + $serverJs + '" 1>"' + $log + '" 2>"' + "$log.err" + '""'
  # cmd.exe works from TEMP: a process whose working folder is inside the app
  # would lock that folder against the next update. (The server moves into its
  # own folder by itself.)
  $server = Start-Process -FilePath $env:ComSpec -ArgumentList $cmdLine `
    -WorkingDirectory $env:TEMP -WindowStyle Hidden -PassThru

  $up = $false
  for ($i = 0; $i -lt 90; $i++) {
    if (Test-OurApp $port) { $up = $true; break }
    if ($server.HasExited) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $up) {
    $msg = "Six Degrees could not start. The log is at $log.err"
    if ($NoOpen) { Write-Error $msg; exit 1 }
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($msg, 'Six Degrees') | Out-Null
    exit 1
  }
}

$url = "http://127.0.0.1:$port/"
if ($NoOpen) { Write-Output $url; exit 0 }

# An app window, not a tab: Chrome if it is there, else Edge (always there on
# Windows 10 and 11), else whatever the default browser is.
$browsers = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
) | Where-Object { $_ -and (Test-Path $_) }

if ($browsers) {
  Start-Process -FilePath ($browsers | Select-Object -First 1) -ArgumentList "--app=$url", '--window-size=1400,900'
} else {
  Start-Process $url
}
