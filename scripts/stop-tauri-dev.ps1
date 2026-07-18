[CmdletBinding()]
param([string]$Distribution = "Ubuntu", [string]$SessionId)

$ErrorActionPreference = "Stop"
$repoWindows = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoWsl = (& wsl.exe -d $Distribution -- wslpath -a ($repoWindows -replace '\\', '/')).Trim()
$argument = if ($SessionId) { "--session '$SessionId'" } else { "" }
& wsl.exe -d $Distribution -- bash -lc "cd '$repoWsl' && ./stop-dev.sh $argument"
