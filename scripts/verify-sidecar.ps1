param(
    [string]$Executable,
    [string]$DataRoot,
    [int]$StartupTimeoutSeconds = 90,
    [int]$ShutdownTimeoutSeconds = 20
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Executable) { $Executable = Join-Path $Root "dist\operatoros-sidecar.exe" }
if (-not $DataRoot) {
    $DataRoot = Join-Path $env:TEMP "OperatorOS-Sidecar-Verify\$([Guid]::NewGuid())\OperatorOS"
}
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    throw "Sidecar executable not found: $Executable"
}
$VerificationBin = Join-Path (Split-Path -Parent $DataRoot) "bin"
New-Item -ItemType Directory -Force -Path $VerificationBin | Out-Null
$LocalExecutable = Join-Path $VerificationBin "operatoros-sidecar.exe"
Copy-Item -Force -LiteralPath $Executable -Destination $LocalExecutable

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$Port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

$env:OPERATOROS_DATA_DIR = Join-Path $DataRoot "Data"
$env:OPERATOROS_LOG_DIR = Join-Path $DataRoot "Logs"
$env:OPERATOROS_RUNTIME_DIR = Join-Path $DataRoot "Runtime"
$env:OPERATOROS_VERSION = "verification"

Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class OperatorOSConsoleProcess {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO {
        public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public int dwX; public int dwY; public int dwXSize; public int dwYSize;
        public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute;
        public int dwFlags; public short wShowWindow; public short cbReserved2;
        public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION {
        public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string applicationName, string commandLine, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint creationFlags,
        IntPtr environment, string currentDirectory, ref STARTUPINFO startupInfo,
        out PROCESS_INFORMATION processInformation);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GenerateConsoleCtrlEvent(uint ctrlEvent, uint processGroupId);
    [DllImport("kernel32.dll")]
    private static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);

    public static int Start(string executable, int port) {
        var startup = new STARTUPINFO(); startup.cb = Marshal.SizeOf(startup);
        PROCESS_INFORMATION process;
        string command = "\"" + executable + "\" --port " + port;
        const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;
        if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, false,
            CREATE_NEW_PROCESS_GROUP, IntPtr.Zero, null, ref startup, out process))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        CloseHandle(process.hThread); CloseHandle(process.hProcess);
        return process.dwProcessId;
    }
    public static void GracefulStop(int processGroupId) {
        SetConsoleCtrlHandler(IntPtr.Zero, true);
        try {
            if (!GenerateConsoleCtrlEvent(1, (uint)processGroupId))
                throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally {
            System.Threading.Thread.Sleep(250);
            SetConsoleCtrlHandler(IntPtr.Zero, false);
        }
    }
}
"@

$ProcessId = [OperatorOSConsoleProcess]::Start((Resolve-Path $LocalExecutable).Path, $Port)
$Process = Get-Process -Id $ProcessId

try {
    $Deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    $Health = $null
    while ([DateTime]::UtcNow -lt $Deadline) {
        if ($Process.HasExited) { throw "Sidecar exited during startup with code $($Process.ExitCode)" }
        try {
            $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
            if ($Health.status -eq "ok") { break }
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
    if (-not $Health -or $Health.status -ne "ok") { throw "Sidecar readiness timed out" }
    if ($Health.service -ne "operatoros-sidecar" -or $Health.version -ne "verification") {
        throw "Health response does not match the production contract"
    }
    foreach ($Directory in @("Data", "Backups", "Logs", "Runtime", "Exports")) {
        if (-not (Test-Path -LiteralPath (Join-Path $DataRoot $Directory) -PathType Container)) {
            throw "Runtime directory was not created: $Directory"
        }
    }
    Write-Output "Sidecar ready on http://127.0.0.1:$Port"
} finally {
    if (-not $Process.HasExited) {
        [OperatorOSConsoleProcess]::GracefulStop($Process.Id)
        if (-not $Process.WaitForExit($ShutdownTimeoutSeconds * 1000)) {
            Stop-Process -Id $Process.Id -Force
            throw "Sidecar did not shut down within $ShutdownTimeoutSeconds seconds"
        }
    }
}

Start-Sleep -Milliseconds 500
$Probe = [System.Net.Sockets.TcpClient]::new()
try {
    $Probe.Connect("127.0.0.1", $Port)
    throw "Sidecar port remained open after graceful shutdown"
} catch [System.Net.Sockets.SocketException] {
    # Expected: CTRL_BREAK reached Uvicorn and the listener is closed.
} finally {
    $Probe.Dispose()
}
Write-Output "Sidecar verification passed"
