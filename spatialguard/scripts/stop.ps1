param([switch]$KeepTunnel)

$projectRoot = (Resolve-Path "$PSScriptRoot/../..").Path
$runtimePath = Join-Path $projectRoot '.data/spatialguard/runtime.json'
if (Test-Path -LiteralPath $runtimePath) {
    $runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
    foreach ($processId in @($runtime.child_pids) + @($runtime.supervisor_pid)) {
        $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
        if ($candidate -and $candidate.CommandLine -match 'spatialguard_api|spatialguard[/\\]scripts[/\\]run.py') {
            # Windows venv launchers have a real Python child. Stop only verified
            # SpatialGuard Python descendants before their launcher.
            $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$processId" -ErrorAction SilentlyContinue
            foreach ($child in $children) {
                if ($child.Name -eq 'python.exe' -and $child.CommandLine -match 'spatialguard_api|spatialguard[/\\]scripts[/\\]run.py') {
                    Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
                }
            }
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -LiteralPath $runtimePath -ErrorAction SilentlyContinue
}

$tunnelRuntimePath = Join-Path $projectRoot '.data/spatialguard/ring-tunnel.json'
if (-not $KeepTunnel -and (Test-Path -LiteralPath $tunnelRuntimePath)) {
    $tunnelRuntime = Get-Content -LiteralPath $tunnelRuntimePath -Raw | ConvertFrom-Json
    foreach ($processId in @($tunnelRuntime.pid) + @($tunnelRuntime.supervisor_pid)) {
        $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
        if ($candidate -and ($candidate.CommandLine -match 'cloudflared(.exe)? tunnel --url http://127\.0\.0\.1:8011' -or
                $candidate.CommandLine -match 'spatialguard[/\\]scripts[/\\]ring-tunnel\.py')) {
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -LiteralPath $tunnelRuntimePath -ErrorAction SilentlyContinue
}
