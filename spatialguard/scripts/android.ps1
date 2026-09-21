param([switch]$Install)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path "$PSScriptRoot/../..").Path
$env:JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA/Android/Sdk"
Push-Location "$projectRoot/spatialguard/apps/web"
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
    npx cap sync android
    if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed' }
    Push-Location android
    try {
        ./gradlew.bat assembleDebug
        if ($LASTEXITCODE -ne 0) { throw 'Android build failed' }
    } finally { Pop-Location }
    if ($Install) {
        adb reverse tcp:8010 tcp:8010
        adb install -r android/app/build/outputs/apk/debug/app-debug.apk
        if ($LASTEXITCODE -ne 0) { throw 'APK installation failed' }
        adb shell am start -n dev.spatialguard.preview/.MainActivity
    }
} finally { Pop-Location }
