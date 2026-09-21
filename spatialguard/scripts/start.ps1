$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path "$PSScriptRoot/../..").Path
try {
    $health = Invoke-RestMethod 'http://127.0.0.1:8010/health' -TimeoutSec 2
    if ($health.application -eq 'spatialguard') { return }
} catch {}
Start-Process -FilePath "$projectRoot/.venv/Scripts/python.exe" -ArgumentList 'spatialguard/scripts/run.py' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput "$projectRoot/.data/spatialguard-launch.log" -RedirectStandardError "$projectRoot/.data/spatialguard-launch-error.log"
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8010/health' -TimeoutSec 1
        if ($health.application -eq 'spatialguard') { return }
    } catch {}
    Start-Sleep -Milliseconds 250
}
throw 'SpatialGuard did not start; inspect .data/spatialguard-launch-error.log'
