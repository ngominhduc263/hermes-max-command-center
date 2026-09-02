[CmdletBinding()]
param(
    [string]$HermesRoot = '',
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

$repoPath = Resolve-HermesRepo -Explicit $HermesRoot
$HermesRoot = Split-Path -Parent $repoPath

$hermesExe = Join-Path $repoPath 'bin\hermes.exe'
$logPath = Join-Path $HermesRoot 'logs'
$stdoutLog = Join-Path $logPath 'hermes-dashboard.out.log'
$stderrLog = Join-Path $logPath 'hermes-dashboard.err.log'

if (-not (Test-Path -LiteralPath $hermesExe -PathType Leaf)) {
    throw "Không tìm thấy Hermes: $hermesExe"
}

New-Item -ItemType Directory -Path $logPath -Force | Out-Null

# Keep logs bounded so a long-running Dashboard cannot slowly fill drive D:.
foreach ($log in @($stdoutLog, $stderrLog)) {
    if (
        (Test-Path -LiteralPath $log -PathType Leaf) -and
        (Get-Item -LiteralPath $log).Length -gt 10MB
    ) {
        Move-Item -LiteralPath $log -Destination "$log.previous" -Force
    }
}

$existingListener = Get-NetTCPConnection `
    -LocalPort $Port `
    -State Listen `
    -ErrorAction SilentlyContinue

if ($existingListener) {
    exit 0
}

Set-Location -LiteralPath $repoPath

$dashboardProcess = Start-Process `
    -FilePath $hermesExe `
    -ArgumentList @('dashboard', '--skip-build') `
    -WorkingDirectory $repoPath `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

$dashboardProcess.WaitForExit()
exit $dashboardProcess.ExitCode
