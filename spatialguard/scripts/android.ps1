param(
    [switch]$Install,
    [switch]$Release,
    [switch]$Bundle,
    [string]$ApiUrl = 'https://spatialguard-production.up.railway.app'
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path "$PSScriptRoot/../..").Path
$env:JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA/Android/Sdk"
Push-Location "$projectRoot/spatialguard/apps/web"
try {
    $env:SPATIALGUARD_API_URL = $ApiUrl
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
    npx cap sync android
    if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed' }
    Push-Location android
    try {
        if ($Bundle) {
            if (-not $env:SPATIALGUARD_ANDROID_KEYSTORE -or -not $env:SPATIALGUARD_ANDROID_KEYSTORE_PASSWORD -or -not $env:SPATIALGUARD_ANDROID_KEY_ALIAS -or -not $env:SPATIALGUARD_ANDROID_KEY_PASSWORD) {
                throw 'A signed bundle requires SPATIALGUARD_ANDROID_KEYSTORE, SPATIALGUARD_ANDROID_KEYSTORE_PASSWORD, SPATIALGUARD_ANDROID_KEY_ALIAS, and SPATIALGUARD_ANDROID_KEY_PASSWORD.'
            }
            ./gradlew.bat bundleRelease "-PSPATIALGUARD_API_URL=$ApiUrl"
        } elseif ($Release) {
            ./gradlew.bat assembleRelease "-PSPATIALGUARD_API_URL=$ApiUrl"
        } else {
            ./gradlew.bat assembleDebug
        }
        if ($LASTEXITCODE -ne 0) { throw 'Android build failed' }
    } finally { Pop-Location }
    if ($Install -and ($Release -or $Bundle)) { throw 'Install is supported for the debug build only.' }
    if ($Install) {
        adb reverse tcp:8010 tcp:8010
        adb install -r android/app/build/outputs/apk/debug/app-debug.apk
        if ($LASTEXITCODE -ne 0) { throw 'APK installation failed' }
        adb shell am start -n app.spatialguard.mobile/dev.spatialguard.preview.MainActivity
    }
} finally { Pop-Location }
