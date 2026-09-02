[CmdletBinding()]
param(
    [string]$HermesRoot = '',
    [string]$TaskName = 'Hermes Dashboard',
    [int]$Port = 9119
)

$ErrorActionPreference = 'Stop'

function Test-HermesRepo {
    param([string]$Path)
    if (-not $Path) { return $false }
    foreach ($marker in @('hermes_cli', 'agent', 'web')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Path $marker) -PathType Container)) {
            return $false
        }
    }
    return $true
}

function Resolve-HermesRepo {
    param([string]$Explicit)

    if ($Explicit) {
        # Accept either the parent folder or the repo itself — people paste
        # both, and refusing one of them helps nobody.
        foreach ($candidate in @((Join-Path $Explicit 'hermes-agent'), $Explicit)) {
            if (Test-HermesRepo $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
        }
        throw "Không thấy Hermes trong: $Explicit`nNo Hermes installation under: $Explicit"
    }

    $seen = [System.Collections.Generic.List[string]]::new()

    # 1. `hermes` on PATH — the strongest signal, and free to check.
    $command = Get-Command hermes -ErrorAction SilentlyContinue
    if ($command -and $command.Source) {
        $dir = Split-Path -Parent $command.Source
        for ($i = 0; $i -lt 4 -and $dir; $i++) {
            $seen.Add($dir)
            $dir = Split-Path -Parent $dir
        }
    }

    # 2. A running dashboard/gateway knows its own location.
    foreach ($name in @('hermes', 'node', 'python')) {
        Get-Process -Name $name -ErrorAction SilentlyContinue |
            ForEach-Object {
                try {
                    $exe = $_.Path
                    if ($exe) {
                        $dir = Split-Path -Parent $exe
                        for ($i = 0; $i -lt 4 -and $dir; $i++) {
                            $seen.Add($dir)
                            $dir = Split-Path -Parent $dir
                        }
                    }
                } catch { }
            }
    }

    # 3. The usual spots, on every fixed drive.
    $drives = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
        Where-Object { $_.Root -match '^[A-Za-z]:\\$' } |
        ForEach-Object { $_.Root.TrimEnd('\') }

    $relatives = @(
        'HERMES AGENT\hermes-agent'
        'HERMES-AGENT\hermes-agent'
        'Hermes\hermes-agent'
        'hermes-agent'
        'Tools\HERMES AGENT\hermes-agent'
    )
    foreach ($drive in $drives) {
        foreach ($relative in $relatives) {
            $seen.Add((Join-Path "$drive\" $relative))
        }
    }
    foreach ($base in @($env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA)) {
        if (-not $base) { continue }
        foreach ($relative in @('HERMES AGENT\hermes-agent', 'hermes-agent', 'Hermes\hermes-agent')) {
            $seen.Add((Join-Path $base $relative))
        }
    }

    foreach ($candidate in $seen) {
        if (Test-HermesRepo $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    # 4. Last resort: a shallow scan of each drive root. Depth-limited so this
    #    cannot turn into a full disk crawl.
    foreach ($drive in $drives) {
        try {
            $hit = Get-ChildItem -LiteralPath "$drive\" -Directory -Depth 2 `
                -Filter 'hermes-agent' -ErrorAction SilentlyContinue |
                Where-Object { Test-HermesRepo $_.FullName } |
                Select-Object -First 1
            if ($hit) { return $hit.FullName }
        } catch { }
    }

    throw @"
Không tìm thấy bản cài Hermes Agent nào trên máy.
Could not find a Hermes Agent installation.

Chỉ đường thủ công / point it at yours:
    .\Install-HermesTealMax.ps1 -HermesRoot 'D:\HERMES AGENT'

(-HermesRoot là thư mục CHỨA 'hermes-agent' / the folder that CONTAINS 'hermes-agent'.)
"@
}

$script:ResolvedRepo = Resolve-HermesRepo -Explicit $HermesRoot
$HermesRoot = Split-Path -Parent $script:ResolvedRepo

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

    # VÌ SAO CÓ THÊM LỊCH LẶP.
    #
    # Chỉ có -AtLogOn thì Dashboard nền chết là chết luôn tới lần đăng nhập
    # sau. Mà nó BỊ GIẾT thật, không phải giả thuyết: khi cài (hoặc khi tự sửa
    # chữa / cập nhật) Hermes Desktop chạy scripts\install.ps1, và script đó
    #
    #     taskkill /F /T /IM hermes.exe /FI "PID ne $myPid"
    #
    # tức giết MỌI tiến trình hermes.exe trên máy, rồi quét thêm nhiều lượt
    # theo đường dẫn venv để diệt cả tiến trình được giám sát tự bật lại.
    # Nó có chừa task tự khởi động của Gateway (tìm theo tên *Hermes_Gateway*)
    # nhưng KHÔNG chừa task Dashboard của mình. Trên Windows, `hermes update`
    # cũng dừng dashboard mà không bật lại — đoạn respawn bị chặn bởi
    # `if restart_managed and sys.platform != "win32"`.
    #
    # Nên task phải tự hồi phục. Lịch lặp 10 phút + MultipleInstances IgnoreNew
    # + đoạn kiểm tra port trong Start-HermesDashboard.ps1 (thấy port đã có
    # người nghe thì thoát ngay) nghĩa là: đang chạy thì lần lặp không làm gì,
    # bị giết thì tối đa 10 phút sau sống lại.
    $taskTrigger = New-ScheduledTaskTrigger `
        -AtLogOn `
        -User $currentUser

    try {
        # Gắn lặp vào chính trigger đăng nhập. Mỗi lần đăng nhập là hạn 365
        # ngày được nạp lại, nên thực tế không bao giờ hết hạn.
        $repeating = New-ScheduledTaskTrigger `
            -Once `
            -At (Get-Date) `
            -RepetitionInterval (New-TimeSpan -Minutes 10) `
            -RepetitionDuration (New-TimeSpan -Days 365)
        $taskTrigger.Repetition = $repeating.Repetition
    }
    catch {
        # Bản PowerShell cũ không nhận kiểu gán này. Thà mất khả năng tự hồi
        # phục còn hơn không đăng ký được task.
        Write-Warning "Không gắn được lịch lặp tự hồi phục: $($_.Exception.Message)"
    }

    $taskPrincipal = New-ScheduledTaskPrincipal `
        -UserId $currentUser `
        -LogonType Interactive `
        -RunLevel Limited

    $taskSettings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -MultipleInstances IgnoreNew `
        -RestartCount 5 `
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
