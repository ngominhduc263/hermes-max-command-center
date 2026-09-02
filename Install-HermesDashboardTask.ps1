[CmdletBinding()]
param(
    [string]$HermesRoot = 'D:\HERMES AGENT',
    [string]$TaskName = 'Hermes Dashboard',
    [int]$Port = 9119
)

$ErrorActionPreference = 'Stop'

$stableDir = Join-Path $HermesRoot 'dashboard-max'
$stableLauncher = Join-Path $stableDir 'Start-HermesDashboard.ps1'
$sourceLauncher = Join-Path $PSScriptRoot 'Start-HermesDashboard.ps1'

if (-not (Test-Path -LiteralPath $sourceLauncher -PathType Leaf)) {
    throw "Không tìm thấy launcher trong gói: $sourceLauncher"
}

New-Item -ItemType Directory -Path $stableDir -Force | Out-Null
Copy-Item -LiteralPath $sourceLauncher -Destination $stableLauncher -Force

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$taskAlreadyCorrect = $false

if ($existingTask) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

    $taskAlreadyCorrect = @($existingTask.Actions | Where-Object {
        $_.Execute -match '(?i)powershell(\.exe)?$' -and
        $_.Arguments -like "*$stableLauncher*"
    }).Count -gt 0

    if (-not $taskAlreadyCorrect) {
        try {
            Unregister-ScheduledTask `
                -TaskName $TaskName `
                -Confirm:$false `
                -ErrorAction Stop
        }
        catch {
            throw "Task '$TaskName' được tạo bằng quyền cao hơn. Hãy chạy riêng Install-HermesDashboardTask.ps1 bằng PowerShell Administrator. Chi tiết: $($_.Exception.Message)"
        }
    }
}

# Stop only a Hermes Dashboard process that owns the expected port. Never kill
# an unrelated process merely because it happens to use the same port.
$listeners = Get-NetTCPConnection `
    -LocalPort $Port `
    -State Listen `
    -ErrorAction SilentlyContinue

foreach ($listener in @($listeners)) {
    $processInfo = Get-CimInstance Win32_Process `
        -Filter "ProcessId=$($listener.OwningProcess)" `
        -ErrorAction SilentlyContinue

    if ($processInfo.CommandLine -match '(?i)hermes.+dashboard') {
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$actionArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$stableLauncher`" -HermesRoot `"$HermesRoot`" -Port $Port"

if (-not $taskAlreadyCorrect) {
    $taskAction = New-ScheduledTaskAction `
        -Execute 'powershell.exe' `
        -Argument $actionArgs

    $taskTrigger = New-ScheduledTaskTrigger `
        -AtLogOn `
        -User $currentUser

    $taskPrincipal = New-ScheduledTaskPrincipal `
        -UserId $currentUser `
        -LogonType Interactive `
        -RunLevel Limited

    $taskSettings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -MultipleInstances IgnoreNew `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero)

    $task = New-ScheduledTask `
        -Action $taskAction `
        -Trigger $taskTrigger `
        -Principal $taskPrincipal `
        -Settings $taskSettings

    try {
        Register-ScheduledTask `
            -TaskName $TaskName `
            -InputObject $task `
            -Force `
            -ErrorAction Stop |
            Out-Null
    }
    catch {
        throw "Không thể đăng ký task '$TaskName'. Hãy chạy script bằng PowerShell Administrator. Chi tiết: $($_.Exception.Message)"
    }
}

Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop

$listener = $null
$deadline = (Get-Date).AddMinutes(2)

do {
    Start-Sleep -Seconds 3
    $listener = Get-NetTCPConnection `
        -LocalPort $Port `
        -State Listen `
        -ErrorAction SilentlyContinue
}
until ($listener -or (Get-Date) -ge $deadline)

if (-not $listener) {
    $stderrLog = Join-Path $HermesRoot 'logs\hermes-dashboard.err.log'
    throw "Dashboard chưa mở port $Port sau 2 phút. Xem log: $stderrLog"
}

$httpStatus = (
    Invoke-WebRequest `
        -Uri "http://127.0.0.1:$Port/" `
        -UseBasicParsing `
        -TimeoutSec 20
).StatusCode

[pscustomobject]@{
    Result       = 'HERMES_DASHBOARD_BACKGROUND_PASS'
    HTTP         = $httpStatus
    URL          = "http://127.0.0.1:$Port/"
    PID          = @($listener.OwningProcess) -join ', '
    Task         = $TaskName
    TaskState    = (Get-ScheduledTask -TaskName $TaskName).State
    Launcher     = $stableLauncher
}
