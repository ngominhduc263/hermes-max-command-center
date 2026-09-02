<#
.SYNOPSIS
    Put the stock Hermes dashboard back, undoing Install-HermesTealMax.ps1.

.DESCRIPTION
    Restores every file the install backed up — including the core files it
    patched in place and the built web_dist — from the newest backup, or from
    the one named with -BackupPath.

    The current state is snapshotted first, so even the restore is reversible.

.EXAMPLE
    .\Restore-HermesDashboard.ps1
    .\Restore-HermesDashboard.ps1 -HermesRoot 'E:\Tools\HERMES AGENT'
#>
[CmdletBinding()]
param(
    [string]$HermesRoot = '',
    [string]$BackupPath = '',
    [string]$TaskName = 'Hermes Dashboard'
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

$repoPath = Resolve-HermesRepo -Explicit $HermesRoot
$HermesRoot = Split-Path -Parent $repoPath
Write-Host "Hermes: $repoPath" -ForegroundColor Cyan

$backupRoot = Join-Path $HermesRoot 'backups'
$distPath = Join-Path $repoPath 'hermes_cli\web_dist'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not $BackupPath) {
    $latestBackup = Get-ChildItem `
        -LiteralPath $backupRoot `
        -Directory `
        -Filter 'hermes-teal-max-*' `
        -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $latestBackup) {
        throw "Không tìm thấy backup Hermes Teal Max trong: $backupRoot"
    }

    $BackupPath = $latestBackup.FullName
}

$resolvedBackupRoot = [IO.Path]::GetFullPath($backupRoot).TrimEnd('\') + '\'
$resolvedBackupPath = [IO.Path]::GetFullPath($BackupPath).TrimEnd('\') + '\'

if (-not $resolvedBackupPath.StartsWith(
    $resolvedBackupRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Backup phải nằm trong: $backupRoot"
}

$manifestPath = Join-Path $BackupPath 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Backup không có manifest hợp lệ: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw |
    ConvertFrom-Json -ErrorAction Stop

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
    'web\src\i18n\context.tsx'
    'web\src\i18n\types.ts'
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
    'agent\i18n.py'
    'tools\approval.py'
    'hermes_cli\web_server.py'
    'web\src\main.tsx'
)

$originalFiles = @($manifest.ExistingFiles)
$rescuePath = Join-Path $backupRoot "dashboard-before-restore-$stamp"
New-Item -ItemType Directory -Path $rescuePath -Force | Out-Null

# Snapshot the currently installed Dashboard too, so even the restore action
# itself remains reversible.
foreach ($relativeFile in $relativeFiles) {
    $currentFile = Join-Path $repoPath $relativeFile
    if (Test-Path -LiteralPath $currentFile -PathType Leaf) {
        $rescueFile = Join-Path $rescuePath $relativeFile
        New-Item -ItemType Directory -Path (Split-Path $rescueFile -Parent) -Force |
            Out-Null
        Copy-Item -LiteralPath $currentFile -Destination $rescueFile -Force
    }
}

if (Test-Path -LiteralPath $distPath -PathType Container) {
    Copy-Item `
        -LiteralPath $distPath `
        -Destination (Join-Path $rescuePath 'web_dist') `
        -Recurse `
        -Force
}

& (Join-Path $PSScriptRoot 'Stop-HermesDashboardTask.ps1') `
    -TaskName $TaskName

foreach ($relativeFile in $relativeFiles) {
    $target = Join-Path $repoPath $relativeFile
    $backupFile = Join-Path $BackupPath $relativeFile

    if ($originalFiles -contains $relativeFile) {
        if (-not (Test-Path -LiteralPath $backupFile -PathType Leaf)) {
            throw "Backup thiếu file đã ghi trong manifest: $backupFile"
        }

        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force |
            Out-Null
        Copy-Item -LiteralPath $backupFile -Destination $target -Force
    }
    elseif (Test-Path -LiteralPath $target -PathType Leaf) {
        Remove-Item -LiteralPath $target -Force
    }
}

$distBackup = Join-Path $BackupPath 'web_dist'
if (-not (Test-Path -LiteralPath $distBackup -PathType Container)) {
    throw "Backup thiếu web_dist: $distBackup"
}

if (Test-Path -LiteralPath $distPath -PathType Container) {
    Remove-Item -LiteralPath $distPath -Recurse -Force
}
Copy-Item -LiteralPath $distBackup -Destination $distPath -Recurse -Force

& (Join-Path $PSScriptRoot 'Install-HermesDashboardTask.ps1') `
    -HermesRoot $HermesRoot `
    -TaskName $TaskName

[pscustomobject]@{
    Result = 'HERMES_DASHBOARD_RESTORE_PASS'
    RestoredFrom = $BackupPath
    PreRestoreBackup = $rescuePath
    URL = 'http://127.0.0.1:9119/'
}
