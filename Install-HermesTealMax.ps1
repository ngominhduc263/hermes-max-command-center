<#
.SYNOPSIS
    Install the Hermes Max Command Center dashboard over a Hermes Agent
    installation.

.DESCRIPTION
    Copies the overlay files, patches a few core files in place, rebuilds the
    web workspace and restarts the dashboard background task.

    Everything it touches is backed up first, to
    <HermesRoot>\backups\hermes-teal-max-<timestamp>\, so the install can
    always be undone with Restore-HermesDashboard.ps1.

.PARAMETER HermesRoot
    Folder that CONTAINS the `hermes-agent` repo, e.g. 'D:\HERMES AGENT'.
    Leave it out and the script finds the installation itself.

.PARAMETER Language
    'auto'  (default) keep Hermes's own language, unless Windows is set to
            Vietnamese, in which case switch the dashboard to Vietnamese.
    'vi'    always switch the dashboard to Vietnamese.
    'en'    never change the language.

.EXAMPLE
    .\Install-HermesTealMax.ps1
    .\Install-HermesTealMax.ps1 -HermesRoot 'E:\Tools\HERMES AGENT'
    .\Install-HermesTealMax.ps1 -Language vi
#>
[CmdletBinding()]
param(
    [string]$HermesRoot = '',
    [switch]$SkipBackgroundTask,
    [switch]$SkipTests,
    [switch]$FullTests,
    [ValidateSet('auto', 'vi', 'en')]
    [string]$Language = 'auto',
    # Kept for older instructions; same effect as -Language en.
    [switch]$SkipVietnamese
)

$ErrorActionPreference = 'Stop'

# ── Find the Hermes installation ─────────────────────────────────────────
#
# The package used to hard-code 'D:\HERMES AGENT', which is where it was
# built, not where anyone else keeps Hermes. This looks in the places a real
# installation actually turns up, cheapest first, and only then falls back to
# scanning drives — so a normal install resolves instantly and an unusual one
# still resolves without the user having to know the flag.

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

$repoPath = Resolve-HermesRepo -Explicit $HermesRoot
$HermesRoot = Split-Path -Parent $repoPath
Write-Host "Hermes: $repoPath" -ForegroundColor Cyan
$overlayPath = Join-Path $PSScriptRoot 'overlay'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $HermesRoot "backups\hermes-teal-max-$stamp"
$distPath = Join-Path $repoPath 'hermes_cli\web_dist'
$dashboardVersion = 'v2.29.0'
$hermesExe = Join-Path $repoPath 'bin\hermes.exe'

if (-not (Test-Path -LiteralPath $repoPath -PathType Container)) {
    throw "Không tìm thấy Hermes repo: $repoPath"
}

if (-not (Test-Path -LiteralPath $overlayPath -PathType Container)) {
    throw "Không tìm thấy overlay Hermes Teal Max: $overlayPath"
}

if (-not (Test-Path -LiteralPath (Join-Path $repoPath 'node_modules') -PathType Container)) {
    throw 'Hermes chưa có node_modules. Chạy hermes update hoàn tất rồi thử lại.'
}

$relativeFiles = @(
    'web\src\App.tsx'
    'web\src\components\AgentRoom.tsx'
    'web\src\components\AgentRoom.test.tsx'
    'web\src\components\AgentTreeCard.tsx'
    'web\src\components\ChatSidebar.tsx'
    'web\src\components\ClarifyCard.tsx'
    'web\src\components\CommandChat.tsx'
    'web\src\components\CommandChat.live.test.tsx'
    'web\src\components\ContextGauge.tsx'
    'web\src\components\ContextGauge.test.tsx'
    'web\src\components\FavoriteModelSwitch.tsx'
    'web\src\components\FavoriteModelSwitch.test.tsx'
    'web\src\components\PermissionsPanel.tsx'
    'web\src\components\PermissionsPanel.test.tsx'
    'web\src\index.css'
    'web\src\lib\agent-room.ts'
    'web\src\lib\agent-room.test.ts'
    'web\src\lib\chat-approval.ts'
    'web\src\lib\chat-approval.test.ts'
    'web\src\lib\chat-context-usage.ts'
    'web\src\lib\chat-context-usage.test.ts'
    'web\src\lib\chat-clarify.ts'
    'web\src\lib\chat-clarify.test.ts'
    'web\src\lib\chat-command-catalog.ts'
    'web\src\lib\chat-command-catalog.test.ts'
    'web\src\lib\cron-health.ts'
    'web\src\lib\cron-health.test.ts'
    'web\src\lib\hermes-rooms.ts'
    'web\src\lib\hermes-rooms.test.ts'
    'web\src\lib\room-people.ts'
    'web\src\lib\room-people.test.ts'
    'web\src\lib\room-member-model.ts'
    'web\src\lib\room-member-model.test.ts'
    'web\src\lib\hermes-pet.ts'
    'web\src\lib\hermes-pet.test.ts'
    'web\src\lib\session-tools.ts'
    'web\src\lib\session-tools.test.ts'
    'web\src\lib\hermes-rollback.ts'
    'web\src\lib\hermes-rollback.test.ts'
    'web\src\components\PetCorner.tsx'
    'web\src\components\PetCorner.test.tsx'
    'web\src\components\SessionTools.tsx'
    'web\src\components\CheckpointsPanel.tsx'
    'web\src\lib\chat-composer.ts'
    'web\src\lib\chat-composer.test.ts'
    'web\src\lib\chat-favorite-models.ts'
    'web\src\lib\chat-favorite-models.test.ts'
    'web\src\lib\hermes-commands.ts'
    'web\src\lib\hermes-commands.test.ts'
    'web\src\lib\hermes-permissions.ts'
    'web\src\lib\hermes-permissions.test.ts'
    'web\src\lib\chat-live-turn.ts'
    'web\src\lib\chat-live-turn.test.ts'
    'web\src\lib\chat-transcript.ts'
    'web\src\lib\chat-transcript.test.ts'
    'web\src\lib\chat-waiting-lines.ts'
    'web\src\lib\chat-waiting-lines.test.ts'
    'web\src\hermes-max.css'
    'web\src\i18n\vi.ts'
    'web\src\pages\CronHealthPage.tsx'
    'web\src\pages\RoomsPage.tsx'
    'web\src\pages\RoomsPage.test.tsx'
    'web\src\lib\session-lineage.ts'
    'web\src\lib\session-lineage.test.ts'
    'web\src\pages\ChatPage.tsx'
    'web\src\pages\SessionsPage.tsx'
    'web\src\themes\presets.ts'
    'locales\vi.yaml'
)

# Mấy file lõi này KHÔNG bị chép đè — Patch-HermesCore.py sửa tại chỗ vài
# dòng. Ghi đè cả file sẽ kéo chúng về bản đóng gói cũ mỗi lần cài, tức là hạ
# cấp một bản Hermes mới hơn. Đã dính hai lần thật:
#   - tools\approval.py: ghi đè là hạ cấp bộ dò lệnh nguy hiểm.
#   - web\src\i18n\types.ts: 02/09/2026 Nous thêm một khoá dịch, bản ghi đè
#     kéo file về bản cũ và làm hỏng biên dịch của cả 16 ngôn ngữ khác — chỉ
#     để gói thêm đúng một dòng `| "vi"`.
# Vẫn sao lưu và khôi phục như mọi file khác, để thao tác cài luôn hoàn tác được.
$patchedFiles = @(
    'agent\i18n.py'
    'tools\approval.py'
    'hermes_cli\web_server.py'
    'web\src\i18n\types.ts'
    'web\src\i18n\context.tsx'
    'web\src\main.tsx'
)
$backedUpFiles = $relativeFiles + $patchedFiles

New-Item -ItemType Directory -Path $backupPath -Force | Out-Null

$existingFiles = @()
foreach ($relativeFile in $backedUpFiles) {
    $target = Join-Path $repoPath $relativeFile
    if (Test-Path -LiteralPath $target -PathType Leaf) {
        $backupTarget = Join-Path $backupPath $relativeFile
        New-Item -ItemType Directory -Path (Split-Path $backupTarget -Parent) -Force |
            Out-Null
        Copy-Item -LiteralPath $target -Destination $backupTarget -Force
        $existingFiles += $relativeFile
    }
}

if (Test-Path -LiteralPath $distPath -PathType Container) {
    Copy-Item `
        -LiteralPath $distPath `
        -Destination (Join-Path $backupPath 'web_dist') `
        -Recurse `
        -Force
}

$manifest = [pscustomobject]@{
    HermesRoot = $HermesRoot
    Repo = $repoPath
    CreatedAt = (Get-Date).ToString('o')
    ExistingFiles = $existingFiles
}

$manifest |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath (Join-Path $backupPath 'manifest.json') -Encoding UTF8

$testsRun = 'bỏ qua'
$corePatch = 'bỏ qua'
$vietnameseTest = 'bỏ qua'
$languageSet = 'giữ nguyên'

try {
    foreach ($relativeFile in $relativeFiles) {
        $source = Join-Path $overlayPath $relativeFile
        $target = Join-Path $repoPath $relativeFile

        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Thiếu file overlay: $source"
        }

        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force |
            Out-Null
        Copy-Item -LiteralPath $source -Destination $target -Force
    }

    # Vá tại chỗ phần lõi (đăng ký tiếng Việt, sửa lỗi thu hồi quyền, bù khoá
    # dịch còn thiếu theo en.yaml của chính bản Hermes này). Bước này chịu
    # được bản Hermes mới hơn: không nhận ra đoạn cần sửa thì bỏ qua kèm cảnh
    # báo chứ không đoán mò, và chạy lại nhiều lần cũng không sao.
    $pythonExe = @(
        (Join-Path $repoPath 'venv\Scripts\python.exe')
        (Join-Path $repoPath '.venv\Scripts\python.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1

    if (-not $pythonExe) {
        $pythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
    }

    if ($pythonExe) {
        & $pythonExe (Join-Path $PSScriptRoot 'Patch-HermesCore.py') $repoPath
        if ($LASTEXITCODE -ne 0) {
            throw "Vá lõi Hermes thất bại với exit code $LASTEXITCODE"
        }
        $corePatch = 'đã áp dụng'
    }
    else {
        $corePatch = 'bỏ qua (không tìm thấy python)'
    }

    Push-Location -LiteralPath $repoPath
    try {
        & npm.cmd run build --workspace web
        if ($LASTEXITCODE -ne 0) {
            throw "Build Dashboard thất bại với exit code $LASTEXITCODE"
        }

        # Tự kiểm tra sau khi build. Mặc định chỉ chạy test của chính overlay
        # (nhanh, và không bao giờ bị test cũ của Hermes làm hỏng bản cài);
        # -FullTests chạy trọn bộ, -SkipTests bỏ hẳn.
        if (-not $SkipTests) {
            if ($FullTests) {
                & npm.cmd run test --workspace web
                $testsRun = 'toàn bộ web'
            }
            else {
                # @() so a single match still splats as an array below.
                $testPaths = @(
                    $relativeFiles |
                        Where-Object { $_ -like '*.test.*' } |
                        ForEach-Object { ($_ -replace '^web\\', '') -replace '\\', '/' }
                )

                & npm.cmd run test --workspace web -- --run @testPaths
                $testsRun = "$($testPaths.Count) file test của overlay"
            }

            if ($LASTEXITCODE -ne 0) {
                throw "Test Dashboard thất bại với exit code $LASTEXITCODE"
            }
        }
    }
    finally {
        Pop-Location
    }

    # Bộ dịch tiếng Việt và cơ chế thu hồi quyền: kiểm tra bằng chính python
    # trong venv của Hermes ($pythonExe đã tìm ở bước vá lõi phía trên).
    if (-not $SkipTests) {
        if ($pythonExe) {
            # Báo cáo, KHÔNG chặn. Thiếu một câu dịch thì Hermes tự rơi về
            # tiếng Anh đúng câu đó — không có gì hỏng. Để nó kéo đổ cả bản
            # cài (như v2.19.0 đã làm khi anh lên bản Hermes mới) là sai tỉ lệ:
            # Dashboard mới là thứ đang cài.
            & $pythonExe (Join-Path $PSScriptRoot 'Test-HermesVietnamese.py') $repoPath
            $viOk = $LASTEXITCODE -eq 0

            & $pythonExe (Join-Path $PSScriptRoot 'Test-HermesPermissions.py') $repoPath
            $permOk = $LASTEXITCODE -eq 0

            # Chặn Dashboard nhảy vào phiên riêng của agent phụ. Hỏng bước này
            # là mất nhánh hội thoại chính khỏi khung chat, nên phải báo rõ.
            & $pythonExe (Join-Path $PSScriptRoot 'Test-HermesSessionTree.py') $repoPath
            $treeOk = $LASTEXITCODE -eq 0

            if ($viOk -and $permOk -and $treeOk) {
                $vietnameseTest = 'đạt'
            }
            elseif (-not $treeOk) {
                $vietnameseTest = 'CÂY PHIÊN chưa vá — Dashboard có thể nhảy vào phiên agent phụ; xem dòng HERMES_TREE_FAIL ở trên'
            }
            elseif ($viOk) {
                $vietnameseTest = 'dịch đạt, THU HỒI QUYỀN chưa vá được — xem dòng HERMES_PERM_FAIL ở trên'
            }
            elseif ($permOk) {
                $vietnameseTest = 'thu hồi quyền đạt, BỘ DỊCH thiếu — xem dòng HERMES_VI_FAIL ở trên'
            }
            else {
                $vietnameseTest = 'CẢ HAI chưa đạt — xem các dòng HERMES_*_FAIL ở trên'
            }
        }
        else {
            $vietnameseTest = 'bỏ qua (không tìm thấy python)'
        }
    }

    # Bản build đã ra lò có đúng là bản này không? Dấu phiên bản nằm trong
    # ChatPage, nên nó phải xuất hiện trong JS đã đóng gói.
    $assetsPath = Join-Path $distPath 'assets'
    $stampFound = $false
    if (Test-Path -LiteralPath $assetsPath -PathType Container) {
        $stampFound = [bool](
            Get-ChildItem -LiteralPath $assetsPath -Filter 'ChatPage-*.js' -File |
                Select-String -SimpleMatch -Pattern $dashboardVersion -List |
                Select-Object -First 1
        )
    }
    if (-not $stampFound) {
        throw "Không thấy dấu phiên bản $dashboardVersion trong web_dist — build chưa ăn."
    }
}
catch {
    foreach ($relativeFile in $backedUpFiles) {
        $target = Join-Path $repoPath $relativeFile
        $backupFile = Join-Path $backupPath $relativeFile

        if (Test-Path -LiteralPath $backupFile -PathType Leaf) {
            Copy-Item -LiteralPath $backupFile -Destination $target -Force
        }
        elseif (Test-Path -LiteralPath $target -PathType Leaf) {
            Remove-Item -LiteralPath $target -Force
        }
    }

    $distBackup = Join-Path $backupPath 'web_dist'
    if (Test-Path -LiteralPath $distBackup -PathType Container) {
        if (Test-Path -LiteralPath $distPath -PathType Container) {
            Remove-Item -LiteralPath $distPath -Recurse -Force
        }
        Copy-Item -LiteralPath $distBackup -Destination $distPath -Recurse -Force
    }

    throw
}

# ── Language ─────────────────────────────────────────────────────────────
#
# The added panels (rooms, session tools, pet, checkpoints) are written in
# Vietnamese, and this package was built Vietnamese-first. But forcing the
# whole dashboard into Vietnamese on someone else's machine is not a
# reasonable default for a public release, so:
#
#   auto (default) — switch only when Windows itself is set to Vietnamese.
#   vi             — always switch.
#   en             — never touch the setting.
$wantVietnamese = switch ($Language) {
    'vi' { $true }
    'en' { $false }
    default {
        $uiCulture = (Get-UICulture).Name
        $sysCulture = ''
        try { $sysCulture = (Get-Culture).Name } catch { }
        ($uiCulture -like 'vi*') -or ($sysCulture -like 'vi*')
    }
}
if ($SkipVietnamese) { $wantVietnamese = $false }

if (-not $wantVietnamese) {
    $languageSet = if ($Language -eq 'en' -or $SkipVietnamese) {
        'giữ nguyên (theo yêu cầu) / left as-is'
    }
    else {
        'giữ nguyên — Windows không phải tiếng Việt. Đổi bằng: hermes config set display.language vi'
    }
}

if ($wantVietnamese) {
    if (Test-Path -LiteralPath $hermesExe -PathType Leaf) {
        try {
            & $hermesExe config set display.language vi | Out-Null
            if ($LASTEXITCODE -eq 0) {
                $languageSet = 'display.language = vi'
            }
            else {
                $languageSet = "chưa đặt được (exit $LASTEXITCODE) — chạy: hermes config set display.language vi"
            }
        }
        catch {
            $languageSet = "chưa đặt được ($($_.Exception.Message)) — chạy: hermes config set display.language vi"
        }
    }
    else {
        $languageSet = 'chưa đặt được (không thấy hermes.exe) — chạy: hermes config set display.language vi'
    }
}

if (-not $SkipBackgroundTask) {
    & (Join-Path $PSScriptRoot 'Install-HermesDashboardTask.ps1') `
        -HermesRoot $HermesRoot
}

[pscustomobject]@{
    Result = 'HERMES_IVORY_GRAPHITE_PASS'
    Version = (& (Join-Path $repoPath 'bin\hermes.exe') --version 2>&1 |
        Select-Object -First 1)
    Dashboard = "Hermes Max Command Center $dashboardVersion Ivory Graphite"
    SelfTest = $testsRun
    CorePatch = $corePatch
    VietnameseCatalog = $vietnameseTest
    Language = $languageSet
    Backup = $backupPath
    SourceChanged = $relativeFiles.Count
    CorePatched = $patchedFiles.Count
}
