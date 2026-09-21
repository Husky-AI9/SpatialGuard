param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path "$PSScriptRoot/../..").Path
$runtimePath = Join-Path $projectRoot '.data/spatialguard/ring-tunnel.json'
if (Test-Path -LiteralPath $runtimePath) {
    $runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
    $tunnel = Get-CimInstance Win32_Process -Filter "ProcessId=$($runtime.pid)" -ErrorAction SilentlyContinue
    if ($tunnel -and $tunnel.ExecutablePath -eq "$projectRoot\.data\spatialguard\tools\cloudflared.exe") {
        if (!$Stop) { Write-Output $runtime.url; return }
        Stop-Process -Id $tunnel.ProcessId
        # The supervisor clears the saved URL when its child exits.
        return
    }
}
if ($Stop) { return }
Start-Process -FilePath "$projectRoot/.venv/Scripts/python.exe" -ArgumentList 'spatialguard/scripts/ring-tunnel.py' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput "$projectRoot/.data/spatialguard/ring-tunnel.log" -RedirectStandardError "$projectRoot/.data/spatialguard/ring-tunnel-error.log"
Write-Output 'Starting the Ring-only tunnel. Its URLs appear in SpatialGuard Settings after startup.'
