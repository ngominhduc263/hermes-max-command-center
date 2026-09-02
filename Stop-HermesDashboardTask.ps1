[CmdletBinding()]
param(
    [string]$TaskName = 'Hermes Dashboard',
    [int]$Port = 9119
)

$ErrorActionPreference = 'Stop'

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

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

[pscustomobject]@{
    Task = $TaskName
    Port = $Port
    Listening = [bool](
        Get-NetTCPConnection `
            -LocalPort $Port `
            -State Listen `
            -ErrorAction SilentlyContinue
    )
}
