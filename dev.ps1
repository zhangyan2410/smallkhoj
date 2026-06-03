# dev.ps1 - SmallKhoj dev service manager (PowerShell)
# Usage:
#   .\dev.ps1 start       Start backend + frontend
#   .\dev.ps1 stop        Stop all services
#   .\dev.ps1 restart     Restart all services
#   .\dev.ps1 status      Show service status
#   .\dev.ps1 logs [backend|frontend]  Tail logs

$ErrorActionPreference = "Continue"

$RootDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidDir    = Join-Path $RootDir ".dev-pids"
$LogDir    = Join-Path $RootDir ".dev-logs"
$BackendDir   = Join-Path $RootDir "backend"
$FrontendDir  = Join-Path $RootDir "frontend"

$BackendPort   = 8000
$FrontendPort  = 3000
$BackendPidFile  = Join-Path $PidDir "backend.pid"
$FrontendPidFile = Join-Path $PidDir "frontend.pid"

# --- helpers ---

function Ensure-Dirs {
    New-Item -ItemType Directory -Path $PidDir -Force | Out-Null
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Log($msg) {
    $ts = (Get-Date).ToString("HH:mm:ss")
    Write-Host "[$ts] $msg"
}

function Warn($msg) {
    $ts = (Get-Date).ToString("HH:mm:ss")
    Write-Host "[$ts] WARN: $msg" -ForegroundColor Yellow
}

function Read-Pid($pidFile) {
    if (Test-Path $pidFile) {
        $storedPid = Get-Content $pidFile -ErrorAction SilentlyContinue
        if ($storedPid -and (Get-Process -Id $storedPid -ErrorAction SilentlyContinue)) {
            return $storedPid
        }
    }
    return $null
}

function Pids-On-Port($port) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        return @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
    }
    return @()
}

function Kill-Tree($targetPid) {
    try {
        Stop-Process -Id $targetPid -Force -ErrorAction Stop
    } catch {
        return
    }
    $waited = 0
    while ($waited -lt 5) {
        if (-not (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)) {
            return
        }
        Start-Sleep -Seconds 1
        $waited++
    }
    # kill orphaned children
    Get-CimInstance Win32_Process |
        Where-Object { $_.ParentProcessId -eq $targetPid } |
        ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

function Force-Kill-Port($port) {
    $pids = Pids-On-Port $port
    if ($pids.Count -gt 0) {
        Warn "Port $port still occupied by PIDs: $($pids -join ', ')"
        foreach ($p in $pids) {
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 1
    }
}

function Wait-Http($url, $maxWaitSec) {
    $waited = 0
    while ($waited -lt $maxWaitSec) {
        try {
            $null = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            return $waited
        } catch {}
        Start-Sleep -Seconds 1
        $waited++
    }
    return -1
}

# --- commands ---

function Cmd-Stop {
    Log "Stopping services..."
    $stopped = $false

    $bePid = Read-Pid $BackendPidFile
    if ($bePid) {
        Log "Stopping backend (PID $bePid)..."
        Kill-Tree $bePid
        Remove-Item $BackendPidFile -Force -ErrorAction SilentlyContinue
        $stopped = $true
    }
    Force-Kill-Port $BackendPort

    $fePid = Read-Pid $FrontendPidFile
    if ($fePid) {
        Log "Stopping frontend (PID $fePid)..."
        Kill-Tree $fePid
        Remove-Item $FrontendPidFile -Force -ErrorAction SilentlyContinue
        $stopped = $true
    }
    Force-Kill-Port $FrontendPort

    if ($stopped) {
        Log "Services stopped."
    } else {
        Log "No running services found."
    }
}

function Cmd-Start {
    Ensure-Dirs

    $backendLog  = Join-Path $LogDir "backend.log"
    $frontendLog = Join-Path $LogDir "frontend.log"
    $backendErr  = Join-Path $LogDir "backend-err.log"
    $frontendErr = Join-Path $LogDir "frontend-err.log"
    "" | Set-Content $backendLog
    "" | Set-Content $frontendLog

    # stop first if already running
    if ((Read-Pid $BackendPidFile) -or (Read-Pid $FrontendPidFile)) {
        Warn "Services already running, stopping first..."
        Cmd-Stop
    }

    # --- start backend ---
    Log "Starting backend on :$BackendPort..."
    $pythonExe = Join-Path $BackendDir ".venv\Scripts\python.exe"
    $beProc = Start-Process `
        -FilePath $pythonExe `
        -ArgumentList "main.py" `
        -WorkingDirectory $BackendDir `
        -RedirectStandardOutput $backendLog `
        -RedirectStandardError $backendErr `
        -PassThru `
        -NoNewWindow
    $beProc.Id | Set-Content $BackendPidFile

    $took = Wait-Http "http://localhost:${BackendPort}/docs" 25
    if ($took -lt 0) {
        Warn "Backend did not respond within 25s - check $backendLog"
    } else {
        Log "Backend ready (took ${took}s, PID $($beProc.Id))"
    }

    # --- start frontend ---
    Log "Starting frontend on :$FrontendPort..."
    $feProc = Start-Process `
        -FilePath "cmd.exe" `
        -ArgumentList "/c npx next dev" `
        -WorkingDirectory $FrontendDir `
        -RedirectStandardOutput $frontendLog `
        -RedirectStandardError $frontendErr `
        -PassThru `
        -NoNewWindow
    $feProc.Id | Set-Content $FrontendPidFile

    $took = Wait-Http "http://localhost:${FrontendPort}" 30
    if ($took -lt 0) {
        Warn "Frontend did not respond within 30s - check $frontendLog"
    } else {
        Log "Frontend ready (took ${took}s, PID $($feProc.Id))"
    }

    Log "All services running. Use '.\dev.ps1 stop' to stop, '.\dev.ps1 logs' to view logs."
}

function Cmd-Status {
    $bePid = Read-Pid $BackendPidFile
    $fePid = Read-Pid $FrontendPidFile
    $beOk = $false
    $feOk = $false

    if ($bePid) {
        try {
            $null = Invoke-WebRequest -Uri "http://localhost:${BackendPort}/docs" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            $beOk = $true
        } catch {}
    }
    if ($fePid) {
        try {
            $null = Invoke-WebRequest -Uri "http://localhost:${FrontendPort}" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            $feOk = $true
        } catch {}
    }

    if ($beOk) {
        Write-Host "Backend  :$BackendPort  RUNNING (PID $bePid)"
    } else {
        Write-Host "Backend  :$BackendPort  STOPPED"
    }
    if ($feOk) {
        Write-Host "Frontend :$FrontendPort RUNNING (PID $fePid)"
    } else {
        Write-Host "Frontend :$FrontendPort STOPPED"
    }
}

function Cmd-Logs($target) {
    Ensure-Dirs
    $backendLog  = Join-Path $LogDir "backend.log"
    $frontendLog = Join-Path $LogDir "frontend.log"

    switch ($target) {
        "backend"  { Get-Content $backendLog -Wait -Tail 50 }
        "frontend" { Get-Content $frontendLog -Wait -Tail 50 }
        default    { Get-Content $backendLog, $frontendLog -Wait -Tail 30 }
    }
}

# --- main ---

$cmd = if ($args.Count -gt 0) { $args[0] } else { "help" }
$arg2 = if ($args.Count -gt 1) { $args[1] } else { "all" }

switch ($cmd) {
    "start"   { Cmd-Start }
    "stop"    { Cmd-Stop }
    "restart" { Cmd-Stop; Start-Sleep -Seconds 2; Cmd-Start }
    "status"  { Cmd-Status }
    "logs"    { Cmd-Logs $arg2 }
    default {
        Write-Host "SmallKhoj Dev Manager (PowerShell)"
        Write-Host ""
        Write-Host "Usage: .\dev.ps1 <command>"
        Write-Host ""
        Write-Host "Commands:"
        Write-Host "  start       Start backend + frontend"
        Write-Host "  stop        Stop all services"
        Write-Host "  restart     Restart all services"
        Write-Host "  status      Show service status"
        Write-Host "  logs [svc]  Tail logs (backend|frontend|all)"
    }
}
