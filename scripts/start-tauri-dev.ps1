[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$WslRepositoryPath,
    [Parameter(Mandatory)][string]$WindowsSourcePath,
    [string]$Distribution = "Ubuntu",
    [ValidateSet("bun", "node")][string]$JavaScriptRuntime = "bun",
    [ValidateSet("fixed", "auto")][string]$PortStrategy = "fixed"
)

$ErrorActionPreference = "Stop"
$expectedBun = "1.3.14"
$expectedNodeMajor = 22

if ($WindowsSourcePath -match '^\\\\wsl(?:\$|\.localhost)\\') {
    throw "SOURCE_NOT_AVAILABLE: Windows Tauri tools must not execute from a WSL UNC path."
}
$windowsRoot = (Resolve-Path -LiteralPath $WindowsSourcePath).Path
if (-not (Test-Path -LiteralPath (Join-Path $windowsRoot ".git"))) {
    throw "SOURCE_NOT_AVAILABLE: WindowsSourcePath is not a Git worktree."
}

$wslCommit = (& wsl.exe -d $Distribution -- git -C $WslRepositoryPath rev-parse HEAD).Trim()
$wslStatus = (& wsl.exe -d $Distribution -- git -C $WslRepositoryPath status --porcelain)
$windowsCommit = (& git -C $windowsRoot rev-parse HEAD).Trim()
$windowsStatus = (& git -C $windowsRoot status --porcelain)
if ($wslStatus) { throw "SOURCE_WORKTREE_DIRTY: WSL worktree contains uncommitted changes." }
if ($windowsStatus) { throw "SOURCE_WORKTREE_DIRTY: Windows worktree contains uncommitted changes." }
if ($wslCommit -ne $windowsCommit) { throw "SOURCE_COMMIT_MISMATCH: WSL=$wslCommit Windows=$windowsCommit" }
Write-Host "SOURCE_COMMITS_MATCH $wslCommit"

$bunExecutable = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
if ($JavaScriptRuntime -eq "bun") {
    if (-not (Test-Path -LiteralPath $bunExecutable)) { throw "BUN_RUNTIME_NOT_FOUND" }
    $bunVersion = (& $bunExecutable --version).Trim()
    if ($bunVersion -ne $expectedBun) { throw "BUN_VERSION_MISMATCH: expected $expectedBun, found $bunVersion" }
} else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw "NODE_22_REQUIRED" }
    $nodeVersion = (& $nodeCommand.Source --version).Trim()
    if ($nodeVersion -notmatch "^v$expectedNodeMajor\.") { throw "NODE_22_REQUIRED: found $nodeVersion" }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "NPM_UNAVAILABLE" }
}

$portArgument = if ($PortStrategy -eq "fixed") { "--tauri-fixed" } else { "--mode tauri" }
$shellCommand = "cd '$WslRepositoryPath' && ./start-dev.sh $portArgument --runtime $JavaScriptRuntime"
$previousSessionId = (& wsl.exe -d $Distribution -- bash -lc "test -s '$WslRepositoryPath/.runtime/operatoros-dev/active-session' && cat '$WslRepositoryPath/.runtime/operatoros-dev/active-session'" 2>$null).Trim()
$job = Start-Job -ScriptBlock {
    param($distro, $command)
    & wsl.exe -d $distro -- bash -lc $command
} -ArgumentList $Distribution, $shellCommand

$ports = $null
$overridePath = $null
$sessionRuntime = $null
$completed = $false
try {
$deadline = (Get-Date).AddSeconds(60)
while (-not $ports) {
    if ((Get-Date) -gt $deadline) {
        Stop-Job $job -ErrorAction SilentlyContinue
        throw "Timed out waiting for WSL runtime state."
    }
    $raw = & wsl.exe -d $Distribution -- bash -lc "test -s '$WslRepositoryPath/.runtime/operatoros-dev/ports.json' && cat '$WslRepositoryPath/.runtime/operatoros-dev/ports.json'"
    if ($raw) {
        try {
            $candidate = $raw | ConvertFrom-Json
            if ($candidate.status -eq "ready" -and $candidate.mode -eq "tauri" -and $candidate.session_id -ne $previousSessionId) { $ports = $candidate }
        } catch { }
    }
    if (-not $ports) { Start-Sleep -Milliseconds 250 }
}

if (-not (Test-NetConnection 127.0.0.1 -Port $ports.frontend_port -InformationLevel Quiet)) { throw "Windows cannot reach WSL frontend." }
if (-not (Test-NetConnection 127.0.0.1 -Port $ports.backend_port -InformationLevel Quiet)) { throw "Windows cannot reach WSL backend." }
Invoke-WebRequest -UseBasicParsing -Uri $ports.frontend_url | Out-Null
Invoke-RestMethod -Uri "$($ports.backend_url)/health" | Out-Null

$sessionRuntime = Join-Path $env:LOCALAPPDATA "OperatorOS\dev\$($ports.session_id)"
New-Item -ItemType Directory -Force -Path $sessionRuntime | Out-Null
$overridePath = Join-Path $sessionRuntime "tauri.dev.override.json"
@{
    build = @{ devUrl = $ports.frontend_url; beforeDevCommand = $null }
    bundle = @{ resources = @() }
} |
    ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8NoBOM $overridePath

$env:OPERATOROS_TAURI_DEV_URL = $ports.frontend_url
    Push-Location $windowsRoot
    if ($JavaScriptRuntime -eq "bun") {
        Push-Location (Join-Path $windowsRoot "frontend")
        try { & $bunExecutable run tauri -- dev --config $overridePath } finally { Pop-Location }
    } else {
        Push-Location (Join-Path $windowsRoot "frontend")
        try { & npm run tauri -- dev --config $overridePath } finally { Pop-Location }
    }
    if ($LASTEXITCODE -ne 0) { throw "Tauri exited with code $LASTEXITCODE" }
    $completed = $true
} finally {
    if ((Get-Location).Path -ne $windowsRoot) { Pop-Location }
    $sessionToStop = if ($ports) { $ports.session_id } else {
        (& wsl.exe -d $Distribution -- bash -lc "test -s '$WslRepositoryPath/.runtime/operatoros-dev/active-session' && cat '$WslRepositoryPath/.runtime/operatoros-dev/active-session'" 2>$null).Trim()
    }
    if ($sessionToStop -and $sessionToStop -ne $previousSessionId) {
        & wsl.exe -d $Distribution -- bash -lc "cd '$WslRepositoryPath' && ./stop-dev.sh --session '$sessionToStop'"
    }
    Remove-Item Env:OPERATOROS_TAURI_DEV_URL -ErrorAction SilentlyContinue
    Stop-Job $job -ErrorAction SilentlyContinue
    Receive-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    if ($completed -and $overridePath -and (Test-Path -LiteralPath $overridePath)) {
        Remove-Item -LiteralPath $overridePath -Force
    } elseif ($sessionRuntime) {
        Write-Warning "Preserved Tauri override and logs under $sessionRuntime"
    }
}
