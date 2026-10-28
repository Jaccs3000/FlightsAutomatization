$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$url = "http://127.0.0.1:3030"
$healthUrl = "$url/api/vault"
$dataDir = Join-Path $root "data"
$launcherLog = Join-Path $dataDir "launcher.log"

New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
function Write-LauncherLog([string]$message) {
  Add-Content -LiteralPath $launcherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message" -Encoding UTF8
}
function Test-App {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 3 -UseBasicParsing
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-App)) {
  if (-not (Test-Path (Join-Path $root "node_modules"))) {
    Write-LauncherLog "No se inicia: faltan dependencias en node_modules."
    exit 1
  }
  Write-LauncherLog "Iniciando Vuela."
  $windowsDir = [Environment]::GetFolderPath("Windows")
  $cmdPath = Join-Path $windowsDir "System32\cmd.exe"
  $process = Start-Process -FilePath $cmdPath -ArgumentList '/d /s /c "npm run dev >> data\app.log 2>&1"' -WorkingDirectory $root -WindowStyle Hidden -PassThru

  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Seconds 2
    if (Test-App) { $ready = $true; break }
    $process.Refresh()
    if ($process.HasExited) { break }
  }
  if (-not $ready) {
    Write-LauncherLog "La app no respondio en 80 segundos; revisar data\app.log."
    exit 1
  }
  Write-LauncherLog "Vuela quedo disponible."
} else {
  Write-LauncherLog "Vuela ya estaba ejecutandose."
}

# Open with the default browser; Windows opens a new tab when that browser is already running.
Start-Process $url
Write-LauncherLog "Se abrio $url en el navegador predeterminado."
