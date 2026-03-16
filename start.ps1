$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "Motif Launcher"

$root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend  = Join-Path $root "backend"
$python   = Join-Path $backend "venv\Scripts\python.exe"
$frontend = Join-Path $root "frontend"
$logDir   = Join-Path $root ".logs"

$COMFYUI_PYTHON = "D:\ai\ComfyUI-aki-v1.6\python\python.exe"
$COMFYUI_MAIN   = "D:\ai\ComfyUI-aki-v1.6\ComfyUI\main.py"

# ── Win32 Job Object (auto-kill children on parent exit) ───────────────────────

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class JobObject : IDisposable {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr lpAttributes, string lpName);

    [DllImport("kernel32.dll")]
    static extern bool SetInformationJobObject(IntPtr hJob, int infoType,
        IntPtr lpInfo, uint cbInfoLength);

    [DllImport("kernel32.dll")]
    static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr hObject);

    private IntPtr _handle;

    public JobObject() {
        _handle = CreateJobObject(IntPtr.Zero, null);
        // Set KILL_ON_JOB_CLOSE (ExtendedLimitInformation class = 9)
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr ptr = Marshal.AllocHGlobal(size);
        Marshal.StructureToPtr(info, ptr, false);
        SetInformationJobObject(_handle, 9, ptr, (uint)size);
        Marshal.FreeHGlobal(ptr);
    }

    public bool AddProcess(IntPtr processHandle) {
        return AssignProcessToJobObject(_handle, processHandle);
    }

    public void Dispose() {
        if (_handle != IntPtr.Zero) {
            CloseHandle(_handle);
            _handle = IntPtr.Zero;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }
}
"@

$job = New-Object JobObject

# ── Single-instance guard (named Mutex) ──────────────────────────────────────

$mutex = New-Object System.Threading.Mutex($false, "Global\MotifLauncher")
if (-not $mutex.WaitOne(0)) {
    Write-Host ""
    Write-Host "[Motif] Another launcher is already running!" -ForegroundColor Red
    Write-Host "  Close the other window first, or press Enter to exit." -ForegroundColor Yellow
    Read-Host | Out-Null
    exit 1
}

# ── Helpers ───────────────────────────────────────────────────────────────────

function Kill-Port([int]$Port) {
    $lines = netstat -ano | Select-String ":${Port}\s+.*LISTENING\s+(\d+)"
    if ($lines) {
        $procIds = $lines | ForEach-Object { $_.Matches[0].Groups[1].Value } | Sort-Object -Unique
        foreach ($procId in $procIds) {
            if ($procId -and $procId -ne "0") {
                & taskkill /F /PID $procId /T 2>$null | Out-Null
            }
        }
        Start-Sleep -Milliseconds 800
    }
}

function Test-Port([int]$Port) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", $Port)
        $tcp.Close()
        return $true
    } catch { return $false }
}

function Wait-Port([int]$Port, [string]$Label, [int]$Timeout = 30) {
    Write-Host "  Waiting for $Label" -NoNewline
    for ($i = 0; $i -lt $Timeout; $i++) {
        Start-Sleep -Seconds 1
        Write-Host "." -NoNewline
        if (Test-Port $Port) {
            Write-Host " OK" -ForegroundColor Green
            return $true
        }
    }
    Write-Host " TIMEOUT" -ForegroundColor Red
    return $false
}

function Start-ManagedProcess([string]$Command, [string]$WorkDir, [string]$StdOut, [string]$StdErr) {
    # Use Start-Process with cmd.exe wrapper for log redirection.
    # No RedirectStandardOutput — .cmd files (npm) break with it.
    # Outer quotes required: cmd /c strips first+last " when first char is ",
    # so we wrap the whole command in an extra pair of quotes.
    $argLine = "/c `"$Command > `"$StdOut`" 2> `"$StdErr`"`""
    $proc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList $argLine `
        -WorkingDirectory $WorkDir `
        -WindowStyle Hidden `
        -PassThru

    # Add to Job Object so OS kills entire process tree when this script exits
    $job.AddProcess($proc.Handle) | Out-Null

    return $proc
}

function Stop-Motif {
    Write-Host ""
    Write-Host "[Motif] Stopping services..." -ForegroundColor Yellow
    Kill-Port 8000
    Write-Host "[Motif] Stopped." -ForegroundColor Green
}

# ── Start ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "==============================" -ForegroundColor Cyan
Write-Host "  Motif Launcher" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# Create log directory
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# UTF-8 for Python child processes
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

# ── 1. Kill old processes ─────────────────────────────────────────────────────

Write-Host "[1/4] Cleaning up old processes..."
Kill-Port 8000

# ── 2. Build frontend ──────────────────────────────────────────────────────

Write-Host "[2/4] Building frontend..."
$buildProc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npm run build" `
    -WorkingDirectory $frontend `
    -WindowStyle Hidden `
    -Wait -PassThru
if ($buildProc.ExitCode -ne 0) {
    Write-Host "  Build failed! (exit code $($buildProc.ExitCode))" -ForegroundColor Red
} else {
    Write-Host "  Done" -ForegroundColor Green
}

# ── 3. Backend (managed, in Job Object) ────────────────────────────────────

Write-Host "[3/4] Starting backend..."
$backendProc = Start-ManagedProcess `
    -Command "`"$python`" -m uvicorn main:app --host 0.0.0.0 --port 8000" `
    -WorkDir $backend `
    -StdOut (Join-Path $logDir "backend.log") `
    -StdErr (Join-Path $logDir "backend-error.log")

if (-not (Wait-Port 8000 "backend" 30)) {
    Write-Host "[Motif] Backend failed! Check .logs/backend-error.log" -ForegroundColor Red
}

# ── 4. ComfyUI (skip if already running, NOT in Job Object) ───────────────

$comfyRunning = $false
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8188/object_info/KSampler" `
         -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    $comfyRunning = ($r.StatusCode -eq 200)
} catch {}

if ($comfyRunning) {
    Write-Host "[Motif] ComfyUI already running" -ForegroundColor Yellow
} else {
    Write-Host "[Motif] Starting ComfyUI (takes 1-2 min first time)..."
    Start-Process -FilePath $COMFYUI_PYTHON `
        -ArgumentList "`"$COMFYUI_MAIN`" --port 8188 --lowvram"
}

# ── 5. Open browser ──────────────────────────────────────────────────────────

Start-Process "http://localhost:8000"

# ── 6. Status display ────────────────────────────────────────────────────────

Write-Host ""
Write-Host "==============================" -ForegroundColor Green
Write-Host "  All services started!" -ForegroundColor Green
Write-Host "==============================" -ForegroundColor Green
Write-Host ""
Write-Host "  App      : http://localhost:8000"
Write-Host "  API Docs : http://localhost:8000/docs"
Write-Host "  ComfyUI  : http://localhost:8188"
Write-Host "  Logs     : .logs/"
Write-Host ""
Write-Host "  Commands:" -ForegroundColor Gray
Write-Host "    Enter  = stop all services" -ForegroundColor Gray
Write-Host "    r      = quick restart (backend + frontend only)" -ForegroundColor Gray
Write-Host "  (ComfyUI will keep running independently)" -ForegroundColor Gray
Write-Host ""

# ── 7. Command loop ──────────────────────────────────────────────────────────

function Start-BackendFrontend {
    Kill-Port 8000

    Write-Host "[Motif] Building frontend..." -ForegroundColor Cyan
    $buildProc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c npm run build" `
        -WorkingDirectory $frontend `
        -WindowStyle Hidden `
        -Wait -PassThru

    Write-Host "[Motif] Starting backend..." -ForegroundColor Cyan
    $script:backendProc = Start-ManagedProcess `
        -Command "`"$python`" -m uvicorn main:app --host 0.0.0.0 --port 8000" `
        -WorkDir $backend `
        -StdOut (Join-Path $logDir "backend.log") `
        -StdErr (Join-Path $logDir "backend-error.log")
    Wait-Port 8000 "backend" 30 | Out-Null

    Write-Host "[Motif] Restarted!" -ForegroundColor Green
    Write-Host ""
}

try {
    while ($true) {
        $cmd = Read-Host ">"
        if ($cmd -eq "r" -or $cmd -eq "R") {
            Write-Host ""
            Write-Host "[Motif] Quick restart..." -ForegroundColor Yellow
            try {
                Start-BackendFrontend
            } catch {
                Write-Host "[Motif] Restart failed: $($_.Exception.Message)" -ForegroundColor Red
                Write-Host "  Press 'r' to retry, or Enter to exit." -ForegroundColor Yellow
            }
        } else {
            break
        }
    }
} catch {
    Write-Host "[Motif] Unexpected error: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    Stop-Motif
    $job.Dispose()
    try { $mutex.ReleaseMutex() } catch {}
    $mutex.Dispose()
}
