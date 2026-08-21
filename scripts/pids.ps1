<#
  pids.ps1 — which Electron process is which, and how to kill them.

  WHY THIS EXISTS. An Electron app is not one process, it is roughly four: a MAIN process plus a
  renderer, a gpu-process and a utility, all sharing the image name electron.exe. Task Manager shows
  four identical rows and no way to tell one instance from two. That ambiguity is what makes the
  device gate unreliable — CLAUDE.md 2.3 says kill every electron.exe AND Focal Registry.exe first,
  because both hold the single-instance lock and a survivor refocuses a stale window and hands back
  a false pass.

  Windows already records everything needed to tell them apart: ParentProcessId, and a command line
  on which Electron stamps --type=renderer / --type=gpu-process / --type=utility. The MAIN process is
  the one with no --type at all. Nothing here is invented and nothing is stored — it is a read of
  what the operating system already knows.

  THE LINE THAT MATTERS MOST is the packaged-app warning. Dev and the installed app share
  %APPDATA%\Focal Registry and one single-instance lock (a known-open root-lane item), so if
  "Focal Registry.exe" appears while you are running npm run dev, the window you are looking at may
  be the OLD packaged bundle, not your build.

  USAGE
    npm run pids                 one-shot table
    npm run pids -- -Watch       live, refreshing every 2 seconds, Ctrl+C to stop
    npm run pids -- -Kill        kill every Electron and Focal Registry process (the device gate)
    npm run pids -- -Kill -Id 55508    kill just that one; its children go with it
#>
param(
  [switch]$Watch,
  [switch]$Kill,
  [int[]]$Id,
  [int]$IntervalSeconds = 2
)

# ponytail: name matching, not a process registry. These are the only two image names the gate cares
# about, and a substring match survives a productName change better than an exact list would.
function Get-AppProcesses {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'electron*' -or $_.Name -like 'Focal Registry*' }
}

function Get-Rows {
  $procs = @(Get-AppProcesses)
  if ($procs.Count -eq 0) { return @() }
  # Parent names resolved in one pass so a row can say "started by npm" instead of a bare number.
  $byId = @{}
  foreach ($p in Get-CimInstance Win32_Process -ErrorAction SilentlyContinue) { $byId[[int]$p.ProcessId] = $p.Name }

  $procs | ForEach-Object {
    $role = 'MAIN'
    if ($_.CommandLine -match '--type=([a-z-]+)') { $role = $matches[1] }
    $parentName = '(gone)'
    if ($byId.ContainsKey([int]$_.ParentProcessId)) { $parentName = $byId[[int]$_.ParentProcessId] }
    [pscustomobject]@{
      PID     = [int]$_.ProcessId
      Role    = $role
      Name    = $_.Name
      Parent  = "$($_.ParentProcessId) $parentName"
      Mem_MB  = [math]::Round($_.WorkingSetSize / 1MB, 0)
      Started = $_.CreationDate
    }
  } | Sort-Object Role, PID
}

function Show-Rows {
  $rows = @(Get-Rows)
  if ($rows.Count -eq 0) {
    Write-Host "Nothing running. The device gate is clear." -ForegroundColor Green
    return
  }
  $rows | Format-Table -AutoSize | Out-String | Write-Host

  $mains = @($rows | Where-Object { $_.Role -eq 'MAIN' })
  Write-Host ("{0} process(es), {1} app instance(s)." -f $rows.Count, $mains.Count) -ForegroundColor Cyan

  # The whole reason for the script: a packaged process alive during dev means dev is lying to you.
  $packaged = @($rows | Where-Object { $_.Name -like 'Focal Registry*' })
  if ($packaged.Count -gt 0) {
    Write-Host "WARNING: Focal Registry.exe is running. It shares the single-instance lock with dev," -ForegroundColor Red
    Write-Host "         so a dev window may be showing the OLD packaged bundle. Kill it before gating." -ForegroundColor Red
  }
}

if ($Kill) {
  if ($Id) {
    # Killing a MAIN process takes its renderer/gpu/utility children with it, so /T is belt-and-braces.
    foreach ($one in $Id) {
      Write-Host "Killing PID $one and its children..." -ForegroundColor Yellow
      taskkill /PID $one /T /F
    }
  } else {
    $all = @(Get-AppProcesses)
    if ($all.Count -eq 0) {
      Write-Host "Nothing to kill. The device gate is already clear." -ForegroundColor Green
    } else {
      Write-Host ("Killing {0} process(es)..." -f $all.Count) -ForegroundColor Yellow
      foreach ($p in $all) { taskkill /PID $p.ProcessId /T /F 2>$null }
      Write-Host "Device gate clear." -ForegroundColor Green
    }
  }
  return
}

if ($Watch) {
  Write-Host "Watching. Ctrl+C to stop." -ForegroundColor DarkGray
  while ($true) {
    Clear-Host
    Write-Host ("Focal Registry - process monitor - {0}" -f (Get-Date -Format 'HH:mm:ss')) -ForegroundColor White
    Show-Rows
    Start-Sleep -Seconds $IntervalSeconds
  }
}

Show-Rows
