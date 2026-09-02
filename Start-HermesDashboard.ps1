[CmdletBinding()]
param(
    [string]$HermesRoot = 'D:\HERMES AGENT',
    [int]$Port = 9119
)

$ErrorActionPreference = 'Stop'

$hermesExe = Join-Path $HermesRoot 'hermes-agent\bin\hermes.exe'
$repoPath = Join-Path $HermesRoot 'hermes-agent'
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
