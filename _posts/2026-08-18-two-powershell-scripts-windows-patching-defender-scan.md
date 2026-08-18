---
title: "Two PowerShell Scripts for Windows Maintenance: Patch Everything and Scan Every Disk in Parallel"
description: "Two small scripts I use to keep a Windows machine patched and scanned. One updates every installed application with winget and prints a verified per-package summary. The other runs a Microsoft Defender full scan across all your fixed disks at once instead of one after another. Both are double-clickable, both self-elevate, and neither closes the window before you have read the result."
date: 2026-08-18 22:00:00 +0100
categories: [Code, DevOps]
tags: [powershell, windows, winget, automation, scripting, security]
---

Windows maintenance on a machine you actually use is two chores: keep the software patched, and scan the disks occasionally. Both are perfectly doable by hand, and both are annoying enough that they slip. My full-disk scan age was **814 days** when I checked it while writing this.

So I built two scripts. They are small, they take no arguments, and you run them by double-clicking. This post is what they do, how to use them, and the handful of things I got wrong on the first attempt that are worth knowing if you write something similar.

Both scripts are reproduced in full at the bottom of this post, so you can copy them straight out. They are plain PowerShell 5.1, no modules to install.

## Script 1: Update Every Installed Application

`winget upgrade --all` is already a good command. The problem is what it tells you when it finishes, which is essentially nothing. It scrolls a few screens of progress bars past you and exits. If three packages failed, you find out by scrolling back, assuming the buffer is deep enough.

What I wanted was the thing `apt` and `dnf` give you for free: a list at the end of what changed. So the script wraps `winget`, watches what it does, and prints this:

```
=====================================================
  SUMMARY
=====================================================
  Updated : 8
  Failed  : 1
  Skipped : 1

  Updated:
    [OK]   OBS Studio  32.0.4 -> 32.2.1
    [OK]   Spotify  1.2.94.583.g60394bd5 -> 1.2.96.518.g366879e1

  Still on the old version (see log):
    [FAIL] GlazeWM  still 3.9.1, wanted 3.10.1

  Skipped (winget needs these targeted by name):
    [SKIP] Obsidian  1.6.3 -> 1.13.7
           winget upgrade --id Obsidian.Obsidian --exact

  Elapsed : 00:04:12
  Finished: 2026-08-17 21:05:44
  Exit    : 0
  Log     : C:\Users\<user>\AppData\Local\WingetUpdateLogs\...-winget-upgrade.log
=====================================================

Press any key to close this window...
```

Four outcomes, and the distinction between them is the whole point:

- **Updated** means the installed version actually changed, verified after the fact.
- **Failed** means the package is still on the version it started on.
- **Skipped** is the interesting one, covered below.
- **Unclear** appears when the package reports no version at all and the result cannot be confirmed either way. I would rather be told that than be lied to.

Everything also goes to a timestamped log under `%LOCALAPPDATA%\WingetUpdateLogs\`, because a failure you can only read while the window is open is a failure you cannot investigate.

### The Skipped Category Exists Because winget Hides Work From You

This is the single most useful thing the script surfaced, and it is why I would suggest running something like it rather than the bare command. `winget upgrade` sometimes prints a **second table** below the main one:

```
The following packages have an upgrade available, but require explicit targeting for upgrade:
Name     Id                Version Available Source
---------------------------------------------------
Obsidian Obsidian.Obsidian 1.6.3   1.13.7    winget
```

`--all` does not touch those packages. It says nothing about them when it finishes, and that table scrolls past before the upgrade output even starts. I had one sitting **seven minor versions behind** because of it. They need targeting by name:

```powershell
winget upgrade --id Obsidian.Obsidian --exact
```

The script parses that second table, reports each entry as skipped, and prints the exact command for each one.

### Why It Verifies Instead of Trusting the Output

Two details here are worth stealing if you write anything that wraps a CLI tool and reports on it.

**The pending-upgrade list is not stable.** My first instinct for "did this package update?" was to compare the pending list before and after: anything that dropped off must have been upgraded. Before building on that, I ran the same command twice, two seconds apart, and diffed the results. They did not agree. Same machine, nothing installed in between. `winget` queries remote sources, and what counts as "available" shifts between invocations. So the script asks directly instead:

```powershell
function Get-InstalledVersion {
    param([string]$Id)
    $out = & winget list --id $Id --exact --accept-source-agreements 2>$null
    $row = Parse-WingetTable -Lines @($out) | Where-Object { $_.Id -eq $Id } | Select-Object -First 1
    if ($row) { return $row.Version }
    return $null
}
```

Snapshot the pending list first to know what you expect to change, run the upgrade, then read each package's installed version afterwards. The list gives you intent, the installed version gives you the outcome.

**Do not split winget's table on whitespace.** It looks like neat columns, and it mostly is, but one package on my machine reports its current version as `ad 9.7.13`. There is a space inside the version string. `-split '\s+'` on that row yields six fields instead of five, every field after `Version` shifts left, and you get silently wrong data for that package with no error. The table is fixed-width, so read the column offsets from the header at runtime:

```powershell
$header = $Lines[$headerIndex]
$cId    = $header.IndexOf('Id')
$cVer   = $header.IndexOf('Version')
$cAvail = $header.IndexOf('Available')
$cSrc   = $header.IndexOf('Source')
```

Reading offsets rather than hardcoding them also means the parser survives a future `winget` changing its column widths, and it handles package names containing spaces and parentheses (`MSI Kombustor 4.1.36 (64-bit)`) that a naive split mangles anyway.

## Script 2: Scan Every Disk at Once with Defender

The second script runs a Microsoft Defender full scan on every fixed disk **simultaneously** rather than one after another.

Defender's own full scan walks your volumes sequentially. If you have one SSD, that is fine. I have seven fixed volumes across several physical disks, and sequential means the scan is limited by one disk's read speed at a time while the others sit idle.

The script discovers the fixed volumes, starts one `MpCmdRun.exe` scan per volume as a background job, then polls every 30 seconds with a running count:

```
=============================================
  Parallel Windows Defender Disk Scanner
=============================================

Disks to scan : C:\, D:\, E:\, F:\, O:\, T:\, V:\
Scan type     : Full custom scan (all files, ScanType 3)

  Started job for C: (Job ID: 1)
  Started job for D: (Job ID: 3)
  ...

[22:41:07] Status - Running: 7 | Completed: 0 | Failed: 0
[22:41:37] Status - Running: 5 | Completed: 2 | Failed: 0
```

### It Really Does Run in Parallel, and Here Is Why That Helps

Worth checking rather than assuming, because plenty of scanners serialise internally and would just queue the requests. I launched two scans concurrently and watched the process list:

```powershell
$procs = @()
foreach ($t in @('E:\', 'V:\')) {
    $procs += Start-Process -FilePath $exe `
        -ArgumentList @('-Scan','-ScanType','3','-File',$t,'-DisableRemediation') `
        -PassThru -WindowStyle Hidden
}
```

Two `MpCmdRun` processes, both alive and working, both exiting 0. No "another scan is in progress" refusal. Defender is happy to run concurrent custom scans.

The reason this is worth doing is a Defender setting most people never look at:

```powershell
Get-MpPreference | Select-Object ScanAvgCPULoadFactor
# ScanAvgCPULoadFactor : 50
```

Defender caps a scan at **50% average CPU load** by default. On a 20-core machine, a single sequential scan leaves a great deal of the box unused while it waits on one disk. Running one scan per disk gets you closer to using the hardware you paid for, without touching that throttle (which exists for good reasons and which I would leave alone).

### Two Bugs I Found in My Own Script While Writing This Up

Being direct about these, because if you copy the version that was on my desktop you inherit both.

**It picked up a drive that is not a disk.** The original filtered `Get-PSDrive` on anything matching a drive-letter root:

```powershell
# Don't do this
$disks = @(Get-PSDrive -PSProvider FileSystem |
           Where-Object { $_.Root -match '^[A-Z]:\\$' } |
           Select-Object -ExpandProperty Root)
```

That returned 8 drives on my machine. Only 7 are real fixed volumes. The extra was `G:`, a **Google Drive virtual mount**: it presents as FAT32, reports as a fixed disk to the legacy WMI class, and does not appear in `Get-Volume` at all. Pointing a recursive full scan at a cloud mount is a genuinely bad idea, because it can force a download of every file in your cloud storage so the scanner can hash it. Ask the storage layer instead of the drive-letter namespace:

```powershell
$disks = @(Get-Volume |
           Where-Object { $_.DriveType -eq 'Fixed' -and $_.DriveLetter -and $_.FileSystemType -ne 'Unknown' } |
           ForEach-Object { "$($_.DriveLetter):\" })
```

`Get-Volume` reports the real `DriveType`, and the cloud mount is simply not in the list.

**The status loop could spin forever.** The polling loop tested `$running` in its `while` condition, but `$running` was only ever assigned *inside* the loop body. It works in the happy path, but if a job lands in a state that is neither `Running` nor `Completed` nor `Failed` (`Blocked`, or `Stopped` if something kills it), the counters stop reconciling and the loop keeps polling a job that will never finish. Test the condition you actually care about:

```powershell
while (@($jobs | Where-Object { $_.State -eq 'Running' }).Count -gt 0) {
    Start-Sleep -Seconds 30
    # ... print status ...
}
```

One more thing worth knowing rather than fixing: **a Defender scan is heavily cache-assisted.** Re-scanning 5.7 GB of `C:\Windows\System32\DriverStore` took **6.4 seconds** on a second pass, because Defender skips files it has already vetted whose contents have not changed. A first full scan of a large disk takes hours. A repeat scan of unchanged data is nearly instant. That is a feature, but do not time a second run and conclude your disks were scanned exhaustively in seconds.

## Making Both Scripts Double-Clickable

Both scripts need Administrator rights, and neither can be launched the obvious way, for two reasons that stack.

**Windows does not run a `.ps1` when you double-click it.** It opens it in whatever is registered for the extension, which on a stock desktop is an editor. That is deliberate: a `.ps1` that executed on double-click would be a gift to anyone sending email attachments. My update script had a header comment that literally said "double-click this file" and had never once worked that way.

**Execution policy blocks it anyway.** Mine is `RemoteSigned` for `CurrentUser`, which refuses unsigned scripts even from a prompt.

The fix for both is a small `.bat` next to each script:

```batch
@echo off
setlocal
:: Self-elevate to Administrator if not already elevated
net session >nul 2>&1
if %errorLevel% == 0 goto :run
echo Requesting Administrator privileges...
powershell -Command "Start-Process cmd -ArgumentList '/c \"%~f0\"' -Verb RunAs"
exit /b

:run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-AllApps.ps1"
```

`net session` is the cheapest elevation test on Windows: it requires admin rights, so its exit code tells you whether you have them. If not, the file relaunches itself via `Start-Process -Verb RunAs`, which raises the UAC prompt. `%~dp0` is the directory the `.bat` lives in, so it finds its script regardless of the working directory.

Double-click the `.bat`, approve UAC, done. No prompt to open, no policy flag to remember.

## Never Let the Window Close on Its Own

If you launch a script by double-clicking, the window closing is the same as the output never existing. Both scripts end on a keypress, and the update script puts the summary and the prompt in a `finally` block so they still appear when something throws halfway through:

```powershell
try {
    # snapshot pending, run the upgrade, verify installed versions
}
catch {
    $exitCode = 1
    Write-Err ("Unexpected error: {0}" -f $_.Exception.Message)
}
finally {
    # ... print the summary ...
    Wait-ForKey
}
```

I tested that by injecting a `throw` partway through: error reported, summary still printed, window still waiting. The keypress itself falls through three methods, because `ReadKey` throws in a host with no interactive console:

```powershell
function Wait-ForKey {
    param([string]$Message = 'Press any key to close this window...')
    Write-Host ''
    Write-Host $Message -ForegroundColor Cyan
    try {
        $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
        return
    } catch {
        try {
            $null = Read-Host 'Press ENTER to close this window'
            return
        } catch {
            & cmd.exe /c pause | Out-Null
        }
    }
}
```

There is one failure mode a PowerShell `finally` cannot catch: the script failing to *start*. A syntax error or a missing file means PowerShell exits before any of your code runs, and the window vanishes with the error in it. So the `.bat` has its own net:

```batch
if errorlevel 1 (
    echo.
    echo The script exited with an error code above.
    pause
)
```

## One Git Gotcha If You Version These

Batch files must keep CRLF line endings. If your repo normalises to LF (`* text=auto eol=lf` is a common default), `cmd.exe` mis-handles the result: labels and `goto` targets stop resolving, so a self-elevating launcher silently falls straight through the elevation block instead of erroring. Pin them:

```
*.bat  text eol=crlf
*.cmd  text eol=crlf
```

Git will warn you about the conversion when you stage the file, which is how I caught it.

## Using Them

Both scripts are in the appendix below. For each one, save the `.ps1` and its `.bat` into the same folder (the launcher finds the script via `%~dp0`, so the folder does not matter as long as they are together), then double-click the `.bat`.

- **Updating apps:** takes a few minutes depending on how far behind you are. Safe to run any time; `--disable-interactivity` is set so no installer prompt can hang it.
- **Scanning disks:** the first run on large disks takes hours. Start it when you do not need the machine. Subsequent runs are much faster thanks to the scan cache.

Requirements are modest: Windows 10 1809+ or Windows 11, PowerShell 5.1 (the version that ships with Windows, no install needed), and winget from the Microsoft Store if you do not already have it. Defender needs to be your active antivirus for the scan script; if you have replaced it with a third-party product, `MpCmdRun` will not be doing the scanning, and the script will warn you that it is running in passive mode.

## Takeaway

Three things I would carry into any maintenance script:

1. **Report what changed, not that you ran.** "Done!" is not a result. A per-item outcome, verified against the state the tool was supposed to change, is what makes a script worth running unattended.
2. **Verify, do not infer.** The pending-upgrade list looked like a perfect before/after signal and was not stable enough to use. A two-second test disproved it. Check that a signal is real before you build a report on it.
3. **Ask the right layer for the right facts.** `Get-PSDrive` answers "what drive letters exist", which is not the same question as "what physical disks should I scan". That mismatch was pointing a recursive scan at cloud storage.

Both scripts are short enough to read in a couple of minutes, which I would recommend doing before running anything that scans your disks or upgrades your software with Administrator rights.

## Appendix: The Full Scripts

Four files, two pairs. Each `.ps1` needs its `.bat` beside it. Copy them out as-is; there is nothing to configure.

### Update-AllApps.ps1

```powershell
<#=====================================================================
  Update-AllApps.ps1
  Runs "winget upgrade --all", then prints a summary of what actually
  changed and waits for a keypress. The window never closes on its own.

  Launch it with Update-AllApps.bat (double-clicking a .ps1 opens the
  default .ps1 file-type handler, which is usually an editor, not
  PowerShell). The .bat self-elevates, then runs this script with
  -ExecutionPolicy Bypass.

  Requires: Windows 10 1809+ or Windows 11, PowerShell 5.1+
=====================================================================#>

#---------------------------------------
# 1. Self-elevation logic (run as Administrator)
#---------------------------------------
$IsElevated = ([Security.Principal.WindowsPrincipal] `
                [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(`
                [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $IsElevated) {
    # $PSCommandPath can be empty when launched via right-click
    $scriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
    if (-not $scriptPath) {
        Write-Host "ERROR: Could not determine script path. Please run from PowerShell directly." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "Elevating to Administrator..." -ForegroundColor Yellow
    try {
        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" -Verb runas
    } catch {
        Write-Host "User cancelled elevation or UAC blocked it." -ForegroundColor Red
        Read-Host "Press Enter to exit"
    }
    exit
}

#---------------------------------------
# 2. Helper functions
#---------------------------------------
function Write-Info { param($msg); Write-Host "[$msg]" -ForegroundColor Gray }
function Write-OK   { param($msg); Write-Host "  $msg"  -ForegroundColor Green }
function Write-Warn { param($msg); Write-Host "  $msg"  -ForegroundColor Yellow }
function Write-Err  { param($msg); Write-Host "  $msg"  -ForegroundColor Red }

# Slice one column out of a fixed-width winget table row.
# Winget pads its columns, and some version strings contain spaces
# (e.g. AnyDesk reports "ad 9.7.13"), so splitting on whitespace loses data.
function Get-Column {
    param([string]$Line, [int]$Start, [int]$End)
    if ($null -eq $Line -or $Start -ge $Line.Length) { return '' }
    if ($End -lt 0 -or $End -gt $Line.Length) { $End = $Line.Length }
    if ($End -le $Start) { return '' }
    return $Line.Substring($Start, $End - $Start).Trim()
}

# Parse a winget table (from "winget upgrade" or "winget list") into objects.
# Column positions are read from the header row rather than assumed.
function Parse-WingetTable {
    param([string[]]$Lines)

    $rows = New-Object System.Collections.Generic.List[object]
    if (-not $Lines) { return $rows }

    $headerIndex = -1
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i] -match '^Name\s+Id\s+Version') { $headerIndex = $i; break }
    }
    if ($headerIndex -lt 0) { return $rows }

    $header = $Lines[$headerIndex]
    $cId    = $header.IndexOf('Id')
    $cVer   = $header.IndexOf('Version')
    $cAvail = $header.IndexOf('Available')
    $cSrc   = $header.IndexOf('Source')

    # "Available" only exists on upgrade-style tables; fall back to Source.
    $verEnd = if ($cAvail -gt 0) { $cAvail } else { $cSrc }

    for ($i = $headerIndex + 1; $i -lt $Lines.Count; $i++) {
        $line = $Lines[$i]
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line -match '^-{5,}$') { continue }
        # Trailing prose ends the table ("11 upgrades available.", etc.)
        if ($line -match '^\d+\s' -or $line -match 'upgrades? available' -or $line -match 'require explicit targeting') { break }

        $name = Get-Column $line 0 $cId
        $id   = Get-Column $line $cId $cVer
        if (-not $id) { continue }

        $rows.Add([pscustomobject]@{
            Name      = $name
            Id        = $id
            Version   = Get-Column $line $cVer $verEnd
            Available = if ($cAvail -gt 0) { Get-Column $line $cAvail $cSrc } else { '' }
        })
    }
    return $rows
}

# Read the currently installed version of one package, or $null if absent.
function Get-InstalledVersion {
    param([string]$Id)
    $out = & winget list --id $Id --exact --accept-source-agreements 2>$null
    $row = Parse-WingetTable -Lines @($out) | Where-Object { $_.Id -eq $Id } | Select-Object -First 1
    if ($row) { return $row.Version }
    return $null
}

# Block until a key is pressed. Falls back through three methods so the
# window still holds open in hosts that do not support ReadKey.
function Wait-ForKey {
    param([string]$Message = 'Press any key to close this window...')
    Write-Host ''
    Write-Host $Message -ForegroundColor Cyan
    try {
        $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
        return
    } catch {
        try {
            $null = Read-Host 'Press ENTER to close this window'
            return
        } catch {
            & cmd.exe /c pause | Out-Null
        }
    }
}

#---------------------------------------
# 3. Everything below runs inside try/finally so the summary and the
#    keypress prompt happen even if a step throws.
#---------------------------------------
$ErrorActionPreference = 'Continue'
$started    = Get-Date
$logDir     = Join-Path $env:LOCALAPPDATA 'WingetUpdateLogs'
$logFile    = Join-Path $logDir ("{0:yyyy-MM-dd-HHmmss}-winget-upgrade.log" -f $started)
$exitCode   = 0
$pending    = @()
$explicit   = @()
$results    = New-Object System.Collections.Generic.List[object]
$fatalError = $null

try {
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

    $Host.UI.RawUI.WindowTitle = 'Winget - Update All Applications'
    Write-Host ''
    Write-Host '=====================================================' -ForegroundColor Cyan
    Write-Host '  Winget - Update All Applications'                    -ForegroundColor Cyan
    Write-Host '=====================================================' -ForegroundColor Cyan
    Write-Host ("  Started: {0:yyyy-MM-dd HH:mm:ss}" -f $started)      -ForegroundColor Gray
    Write-Host ("  Log    : {0}" -f $logFile)                          -ForegroundColor Gray
    Write-Host ''

    # 3.1 Ensure winget is available
    Write-Info 'Checking for winget...'
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        # Refresh PATH in case it was installed after this session started
        $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH','Machine') + ';' +
                    [System.Environment]::GetEnvironmentVariable('PATH','User')
    }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Err 'winget (App Installer) is not available on this machine.'
        Write-Err 'Install "App Installer" from the Microsoft Store, then re-run.'
        $exitCode = 1
        return
    }
    $wingetVersion = (& winget --version 2>$null | Select-Object -First 1)
    Write-OK "winget found ($wingetVersion)."

    # 3.2 Snapshot what is pending BEFORE upgrading, so the summary can
    #     report per-package outcomes rather than just winget's console spew.
    Write-Info 'Checking for available updates...'
    $before  = @(& winget upgrade --include-unknown --accept-source-agreements 2>$null)
    $pending = @(Parse-WingetTable -Lines $before)

    # The "require explicit targeting" block is a second table that
    # "upgrade --all" deliberately skips. Capture it so it gets reported
    # as skipped instead of silently vanishing from the summary.
    $explicitIndex = -1
    for ($i = 0; $i -lt $before.Count; $i++) {
        if ($before[$i] -match 'require explicit targeting') { $explicitIndex = $i; break }
    }
    if ($explicitIndex -ge 0) {
        $explicit = @(Parse-WingetTable -Lines @($before[$explicitIndex..($before.Count - 1)]))
    }

    Set-Content -LiteralPath $logFile -Value ($before -join [Environment]::NewLine) -Encoding UTF8

    if ($pending.Count -eq 0 -and $explicit.Count -eq 0) {
        Write-OK 'Everything is already up to date. Nothing to do.'
        return
    }

    Write-OK ("{0} package(s) with an update available." -f ($pending.Count + $explicit.Count))
    foreach ($p in $pending) {
        Write-Host ("    - {0}  {1} -> {2}" -f $p.Name, $p.Version, $p.Available) -ForegroundColor DarkGray
    }
    Write-Host ''

    # 3.3 Run the upgrade, echoing live output and teeing it to the log.
    Write-Host 'Updating all packages. This may take a while...' -ForegroundColor Yellow
    Write-Host ''

    & winget upgrade --all --include-unknown --accept-package-agreements `
        --accept-source-agreements --disable-interactivity 2>&1 |
        Tee-Object -FilePath $logFile -Append
    $exitCode = $LASTEXITCODE

    # 3.4 Verify by reading each package's installed version afterwards.
    #     Winget's pending list can churn between runs, so "it left the list"
    #     is not proof on its own. Direct version evidence wins; the
    #     after-list is only a tiebreaker for packages whose version reads
    #     "Unknown" (winget cannot determine it, so there is nothing to diff).
    Write-Host ''
    Write-Info 'Verifying installed versions...'
    $after    = @(& winget upgrade --include-unknown --accept-source-agreements 2>$null)
    $afterIds = @(Parse-WingetTable -Lines $after | Select-Object -ExpandProperty Id)

    foreach ($p in $pending) {
        $now          = Get-InstalledVersion -Id $p.Id
        $stillPending = $afterIds -contains $p.Id
        $wasUnknown   = ($p.Version -eq 'Unknown' -or -not $p.Version)

        if     ($now -and $now -eq $p.Available)                   { $status = 'Updated' }
        elseif ($now -and -not $wasUnknown -and $now -ne $p.Version) { $status = 'Updated' }
        elseif (-not $stillPending -and $wasUnknown)               { $status = 'Updated' }
        elseif ($wasUnknown -or -not $now)                         { $status = 'Unknown' }
        else                                                       { $status = 'Failed'  }

        $results.Add([pscustomobject]@{
            Name   = $p.Name
            Id     = $p.Id
            From   = $p.Version
            To     = $p.Available
            Now    = if ($now) { $now } else { '(not detected)' }
            Status = $status
        })
    }
    foreach ($p in $explicit) {
        $results.Add([pscustomobject]@{
            Name   = $p.Name
            Id     = $p.Id
            From   = $p.Version
            To     = $p.Available
            Now    = $p.Version
            Status = 'Skipped'
        })
    }
}
catch {
    $fatalError = $_
    $exitCode = 1
    Write-Host ''
    Write-Err ("Unexpected error: {0}" -f $_.Exception.Message)
    Write-Err ("At: {0}" -f $_.InvocationInfo.PositionMessage)
}
finally {
    #-----------------------------------
    # 4. Summary (always printed, even on error)
    #-----------------------------------
    $finished = Get-Date
    $elapsed  = $finished - $started

    $updated = @($results | Where-Object { $_.Status -eq 'Updated' })
    $failed  = @($results | Where-Object { $_.Status -eq 'Failed'  })
    $skipped = @($results | Where-Object { $_.Status -eq 'Skipped' })
    $unclear = @($results | Where-Object { $_.Status -eq 'Unknown' })

    Write-Host ''
    Write-Host '=====================================================' -ForegroundColor Cyan
    Write-Host '  SUMMARY'                                             -ForegroundColor Cyan
    Write-Host '=====================================================' -ForegroundColor Cyan

    if ($results.Count -eq 0) {
        if ($fatalError) {
            Write-Host '  Run aborted before any package was processed.' -ForegroundColor Red
        } else {
            Write-Host '  Nothing needed updating. All packages are current.' -ForegroundColor Green
        }
    } else {
        Write-Host ("  Updated : {0}" -f $updated.Count) -ForegroundColor Green
        Write-Host ("  Failed  : {0}" -f $failed.Count)  -ForegroundColor $(if ($failed.Count) { 'Red' } else { 'Gray' })
        Write-Host ("  Skipped : {0}" -f $skipped.Count) -ForegroundColor $(if ($skipped.Count) { 'Yellow' } else { 'Gray' })
        if ($unclear.Count) {
            Write-Host ("  Unclear : {0}" -f $unclear.Count) -ForegroundColor Yellow
        }
        Write-Host ''

        if ($updated.Count) {
            Write-Host '  Updated:' -ForegroundColor Green
            foreach ($r in $updated) {
                Write-Host ("    [OK]   {0}  {1} -> {2}" -f $r.Name, $r.From, $r.Now) -ForegroundColor Green
            }
        }
        if ($failed.Count) {
            Write-Host ''
            Write-Host '  Still on the old version (see log):' -ForegroundColor Red
            foreach ($r in $failed) {
                Write-Host ("    [FAIL] {0}  still {1}, wanted {2}" -f $r.Name, $r.Now, $r.To) -ForegroundColor Red
            }
        }
        if ($skipped.Count) {
            Write-Host ''
            Write-Host '  Skipped (winget needs these targeted by name):' -ForegroundColor Yellow
            foreach ($r in $skipped) {
                Write-Host ("    [SKIP] {0}  {1} -> {2}" -f $r.Name, $r.From, $r.To) -ForegroundColor Yellow
                Write-Host ("           winget upgrade --id {0} --exact" -f $r.Id) -ForegroundColor DarkGray
            }
        }
        if ($unclear.Count) {
            Write-Host ''
            Write-Host '  Could not confirm (no version reported):' -ForegroundColor Yellow
            foreach ($r in $unclear) {
                Write-Host ("    [??]   {0}  wanted {1}" -f $r.Name, $r.To) -ForegroundColor Yellow
            }
        }
    }

    $rebootPending =
        (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') -or
        (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired')

    Write-Host ''
    Write-Host ("  Elapsed : {0:hh\:mm\:ss}" -f $elapsed)              -ForegroundColor Gray
    Write-Host ("  Finished: {0:yyyy-MM-dd HH:mm:ss}" -f $finished)    -ForegroundColor Gray
    Write-Host ("  Exit    : {0}" -f $exitCode)                        -ForegroundColor Gray
    if ($logFile -and (Test-Path $logFile)) {
        Write-Host ("  Log     : {0}" -f $logFile) -ForegroundColor Gray
    }
    if ($rebootPending) {
        Write-Host '  NOTE    : a reboot is pending to finish an install.' -ForegroundColor Yellow
    }
    Write-Host '=====================================================' -ForegroundColor Cyan

    # 5. Hold the window open. This is the last thing that runs.
    Wait-ForKey
}
```

### Update-AllApps.bat

```batch
@echo off
setlocal
:: Self-elevate to Administrator if not already elevated
net session >nul 2>&1
if %errorLevel% == 0 goto :run
echo Requesting Administrator privileges...
powershell -Command "Start-Process cmd -ArgumentList '/c \"%~f0\"' -Verb RunAs"
exit /b

:run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-AllApps.ps1"
:: Update-AllApps.ps1 has its own "press any key" prompt. This pause is
:: only a safety net for the case where PowerShell fails to start the
:: script at all (syntax error, missing file), which would otherwise
:: flash the window shut before the error could be read.
if errorlevel 1 (
    echo.
    echo The script exited with an error code above.
    pause
)
endlocal
```

### Invoke-ParallelDefenderScan.ps1

```powershell
#Requires -Version 5.1
<#=====================================================================
  Invoke-ParallelDefenderScan.ps1

  Runs a Microsoft Defender full scan on every local fixed disk at the
  same time, rather than one after another, then prints a per-disk
  summary and waits for a keypress.

  Launch it with Invoke-ParallelDefenderScan.bat (double-clicking a
  .ps1 opens the registered .ps1 handler, which is usually an editor,
  not PowerShell). The .bat self-elevates, then runs this script with
  -ExecutionPolicy Bypass.

  Why parallel: Defender throttles a scan to ScanAvgCPULoadFactor
  (50% by default), and a sequential pass is bounded by one disk's read
  speed while the others idle. Concurrent MpCmdRun instances are
  supported; the engine does not refuse them.

  Requires: Windows 10 1809+ or Windows 11, PowerShell 5.1+,
            Administrator, and Defender as the active antivirus.
=====================================================================#>

#---------------------------------------
# 1. Self-elevation (Defender scans need Administrator)
#---------------------------------------
$IsElevated = ([Security.Principal.WindowsPrincipal] `
                [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(`
                [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $IsElevated) {
    # $PSCommandPath can be empty when launched via right-click
    $scriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
    if (-not $scriptPath) {
        Write-Host "ERROR: Could not determine script path. Please run from PowerShell directly." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "Elevating to Administrator..." -ForegroundColor Yellow
    try {
        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" -Verb runas
    } catch {
        Write-Host "User cancelled elevation or UAC blocked it." -ForegroundColor Red
        Read-Host "Press Enter to exit"
    }
    exit
}

#---------------------------------------
# 2. Helpers
#---------------------------------------
function Write-Info { param($msg); Write-Host "[$msg]" -ForegroundColor Gray }
function Write-OK   { param($msg); Write-Host "  $msg"  -ForegroundColor Green }
function Write-Warn { param($msg); Write-Host "  $msg"  -ForegroundColor Yellow }
function Write-Err  { param($msg); Write-Host "  $msg"  -ForegroundColor Red }

# Locate MpCmdRun.exe. The copy under Program Files is a stub that can lag
# behind; the running engine lives under the versioned Platform directory
# (that is the path WinDefend's own ImagePath points at). Prefer the
# highest Platform version, fall back to the Program Files copy.
function Resolve-MpCmdRun {
    $platformRoot = Join-Path $env:ProgramData 'Microsoft\Windows Defender\Platform'
    if (Test-Path $platformRoot) {
        $newest = Get-ChildItem -Path $platformRoot -Directory -ErrorAction SilentlyContinue |
                  Sort-Object -Property @{ Expression = {
                      # Directory names look like "4.18.26070.9-0"
                      $v = $_.Name -replace '-.*$', ''
                      try { [version]$v } catch { [version]'0.0' }
                  } } -Descending
        foreach ($dir in $newest) {
            $candidate = Join-Path $dir.FullName 'MpCmdRun.exe'
            if (Test-Path $candidate) { return $candidate }
        }
    }
    $fallback = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe'
    if (Test-Path $fallback) { return $fallback }
    return $null
}

# Discover local fixed disks.
#
# Do NOT enumerate drive letters (Get-PSDrive / Win32_LogicalDisk) for this.
# Cloud-sync clients mount a virtual drive that reports as a FIXED disk to
# the legacy WMI class while being absent from Get-Volume. Pointing a
# recursive scan at one can force a download of the entire remote store so
# the engine can hash it. Get-Volume reports the real DriveType.
function Get-FixedScanTargets {
    $volumes = Get-Volume -ErrorAction SilentlyContinue |
               Where-Object {
                   $_.DriveType      -eq 'Fixed'   -and
                   $_.DriveLetter            -and
                   $_.FileSystemType -ne 'Unknown' -and
                   $_.OperationalStatus -eq 'OK'
               }
    return @($volumes | ForEach-Object { '{0}:\' -f $_.DriveLetter } | Sort-Object)
}

# Block until a key is pressed. Falls through three methods so the window
# still holds open in hosts that do not support a raw key read.
function Wait-ForKey {
    param([string]$Message = 'Press any key to close this window...')
    Write-Host ''
    Write-Host $Message -ForegroundColor Cyan
    try {
        $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
        return
    } catch {
        try {
            $null = Read-Host 'Press ENTER to close this window'
            return
        } catch {
            & cmd.exe /c pause | Out-Null
        }
    }
}

#---------------------------------------
# 3. Main. Everything is inside try/finally so the summary and the
#    keypress happen even if a step throws.
#---------------------------------------
$ErrorActionPreference = 'Continue'
$started  = Get-Date
$logDir   = Join-Path $env:LOCALAPPDATA 'DefenderScanLogs'
$logFile  = Join-Path $logDir ("{0:yyyy-MM-dd-HHmmss}-defender-parallel-scan.log" -f $started)
$results  = New-Object System.Collections.Generic.List[object]
$jobs     = New-Object System.Collections.Generic.List[object]
$fatal    = $null

try {
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

    $Host.UI.RawUI.WindowTitle = 'Parallel Defender Disk Scan'
    Write-Host ''
    Write-Host '=====================================================' -ForegroundColor Cyan
    Write-Host '  Parallel Microsoft Defender Disk Scan'               -ForegroundColor Cyan
    Write-Host '=====================================================' -ForegroundColor Cyan

    # 3.1 Locate the engine
    $MpCmdRun = Resolve-MpCmdRun
    if (-not $MpCmdRun) {
        Write-Err 'MpCmdRun.exe not found. Is Microsoft Defender present on this machine?'
        Wait-ForKey
        exit 1
    }
    Write-Info 'Defender engine'
    Write-OK $MpCmdRun

    # 3.2 Warn (do not block) if Defender is not the active AV. A third-party
    #     product puts Defender into passive mode, where MpCmdRun still runs
    #     but is not what is protecting the machine.
    $mode = $null
    try { $mode = (Get-MpComputerStatus -ErrorAction Stop).AMRunningMode } catch { }
    if ($mode -and $mode -ne 'Normal') {
        Write-Warn ("Defender is in '{0}' mode, so another antivirus is likely active." -f $mode)
        Write-Warn 'The scan will still run, but it is not your primary protection.'
    }

    # 3.3 Discover targets
    Write-Info 'Fixed disks to scan'
    $disks = Get-FixedScanTargets
    if ($disks.Count -eq 0) {
        Write-Err 'No local fixed disks found.'
        Wait-ForKey
        exit 1
    }
    Write-OK ($disks -join ', ')
    Write-Host ("  Scan type : full custom scan, all files (ScanType 3)") -ForegroundColor Gray
    Write-Host ("  Started   : {0:yyyy-MM-dd HH:mm:ss}" -f $started) -ForegroundColor Gray
    Write-Host ("  Log       : {0}" -f $logFile) -ForegroundColor Gray

    $throttle = $null
    try { $throttle = (Get-MpPreference -ErrorAction Stop).ScanAvgCPULoadFactor } catch { }
    if ($throttle) {
        Write-Host ("  CPU cap   : {0}% (Defender's ScanAvgCPULoadFactor)" -f $throttle) -ForegroundColor Gray
    }

    Set-Content -LiteralPath $logFile -Encoding UTF8 -Value @(
        "Parallel Defender scan started $started"
        "Engine: $MpCmdRun"
        "Disks : $($disks -join ', ')"
        ''
    )

    # 3.4 One background job per disk
    Write-Host ''
    Write-Host 'Launching one scan per disk...' -ForegroundColor Yellow

    foreach ($disk in $disks) {
        $job = Start-Job -Name ("Scan_{0}" -f $disk.TrimEnd('\')) -ScriptBlock {
            param($exe, $path)

            $start  = Get-Date
            $output = & $exe -Scan -ScanType 3 -File $path 2>&1
            $code   = $LASTEXITCODE
            $end    = Get-Date

            [pscustomobject]@{
                Disk     = $path
                ExitCode = $code
                Started  = $start
                Finished = $end
                Elapsed  = $end - $start
                Output   = @($output)
            }
        } -ArgumentList $MpCmdRun, $disk

        $jobs.Add($job)
        Write-Host ("  {0}  job {1}" -f $disk.PadRight(5), $job.Id) -ForegroundColor Green
    }

    # 3.5 Poll until nothing is left running.
    #
    # Test the live job states in the loop condition. The earlier version
    # kept a $running counter that was only assigned inside the body, so a
    # job reaching a state that is neither Running/Completed/Failed
    # (Blocked, or Stopped if something kills it) left the loop polling
    # forever. Counting 'Running' directly cannot get stuck that way.
    Write-Host ''
    Write-Host 'Scanning. A first full scan of a large disk takes hours.' -ForegroundColor Yellow
    Write-Host 'Repeat scans are much faster because Defender caches file verdicts.' -ForegroundColor Gray
    Write-Host ''

    while (@($jobs | Where-Object { $_.State -eq 'Running' }).Count -gt 0) {
        Start-Sleep -Seconds 30

        $running  = @($jobs | Where-Object { $_.State -eq 'Running' }).Count
        $done     = @($jobs | Where-Object { $_.State -eq 'Completed' }).Count
        $bad      = @($jobs | Where-Object { $_.State -notin 'Running','Completed' }).Count
        $mins     = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)

        Write-Host ("[{0:HH:mm:ss}] +{1,6} min | running {2} | done {3} | other {4}" -f `
            (Get-Date), $mins, $running, $done, $bad) -ForegroundColor Cyan
    }

    # 3.6 Collect results
    foreach ($job in $jobs) {
        $payload = $null
        try { $payload = Receive-Job -Job $job -ErrorAction Stop } catch { }

        $row = $payload | Where-Object { $_.Disk } | Select-Object -First 1
        if ($row) {
            # MpCmdRun returns 0 when a scan completes and finds nothing to
            # report. 2 means the scan ran and found something.
            $status = switch ($row.ExitCode) {
                0       { 'Clean' }
                2       { 'Threats found' }
                default { 'Error' }
            }
            $results.Add([pscustomobject]@{
                Disk     = $row.Disk
                Status   = $status
                ExitCode = $row.ExitCode
                Elapsed  = $row.Elapsed
                Output   = $row.Output
                State    = $job.State
            })
        } else {
            $results.Add([pscustomobject]@{
                Disk     = ($job.Name -replace '^Scan_', '') + '\'
                Status   = 'No result'
                ExitCode = $null
                Elapsed  = $null
                Output   = @("job ended in state '$($job.State)' without returning a result")
                State    = $job.State
            })
        }
    }

    Add-Content -LiteralPath $logFile -Encoding UTF8 -Value (
        $results | ForEach-Object {
            @(
                "=== $($_.Disk) : $($_.Status) (exit $($_.ExitCode), job $($_.State)) ==="
                ($_.Output -join [Environment]::NewLine)
                ''
            )
        }
    )
}
catch {
    $fatal = $_
    Write-Host ''
    Write-Err ("Unexpected error: {0}" -f $_.Exception.Message)
    Write-Err ("At: {0}" -f $_.InvocationInfo.PositionMessage)
}
finally {
    #-----------------------------------
    # 4. Summary (always printed)
    #-----------------------------------
    $finished = Get-Date
    $elapsed  = $finished - $started

    $clean   = @($results | Where-Object { $_.Status -eq 'Clean' })
    $threats = @($results | Where-Object { $_.Status -eq 'Threats found' })
    $errored = @($results | Where-Object { $_.Status -in 'Error','No result' })

    Write-Host ''
    Write-Host '=====================================================' -ForegroundColor Cyan
    Write-Host '  SCAN SUMMARY'                                        -ForegroundColor Cyan
    Write-Host '=====================================================' -ForegroundColor Cyan

    if ($results.Count -eq 0) {
        if ($fatal) {
            Write-Host '  Run aborted before any disk was scanned.' -ForegroundColor Red
        } else {
            Write-Host '  No scans were run.' -ForegroundColor Yellow
        }
    } else {
        Write-Host ("  Clean   : {0}" -f $clean.Count)   -ForegroundColor Green
        Write-Host ("  Threats : {0}" -f $threats.Count) -ForegroundColor $(if ($threats.Count) { 'Red' } else { 'Gray' })
        Write-Host ("  Errors  : {0}" -f $errored.Count) -ForegroundColor $(if ($errored.Count) { 'Red' } else { 'Gray' })
        Write-Host ''

        foreach ($r in ($results | Sort-Object Disk)) {
            $tag, $colour = switch ($r.Status) {
                'Clean'         { '[OK]  ', 'Green'  }
                'Threats found' { '[!!]  ', 'Red'    }
                default         { '[ERR] ', 'Red'    }
            }
            $took = if ($r.Elapsed) { $r.Elapsed.ToString('hh\:mm\:ss') } else { '--:--:--' }
            Write-Host ("    {0} {1}  {2}  ({3})" -f $tag, $r.Disk.PadRight(4), $took, $r.Status) -ForegroundColor $colour
        }

        if ($threats.Count) {
            Write-Host ''
            Write-Host '  Defender reported detections. Review them with:' -ForegroundColor Red
            Write-Host '    Get-MpThreatDetection | Sort-Object InitialDetectionTime -Descending' -ForegroundColor Yellow
            Write-Host '  Defender will normally have quarantined them already.' -ForegroundColor Gray
        }
    }

    Write-Host ''
    Write-Host ("  Elapsed : {0:hh\:mm\:ss}" -f $elapsed)           -ForegroundColor Gray
    Write-Host ("  Finished: {0:yyyy-MM-dd HH:mm:ss}" -f $finished) -ForegroundColor Gray
    if ($logFile -and (Test-Path $logFile)) {
        Write-Host ("  Log     : {0}" -f $logFile) -ForegroundColor Gray
    }
    Write-Host '=====================================================' -ForegroundColor Cyan

    # Clean up jobs. Stop anything still running first, or Remove-Job -Force
    # leaves orphaned MpCmdRun processes behind.
    foreach ($job in $jobs) {
        if ($job.State -eq 'Running') { Stop-Job -Job $job -ErrorAction SilentlyContinue }
    }
    $jobs | Remove-Job -Force -ErrorAction SilentlyContinue

    # 5. Hold the window open. This is the last thing that runs.
    Wait-ForKey
}
```

### Invoke-ParallelDefenderScan.bat

```batch
@echo off
setlocal
:: Self-elevate to Administrator if not already elevated
net session >nul 2>&1
if %errorLevel% == 0 goto :run
echo Requesting Administrator privileges...
powershell -Command "Start-Process cmd -ArgumentList '/c \"%~f0\"' -Verb RunAs"
exit /b

:run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-ParallelDefenderScan.ps1"
:: Invoke-ParallelDefenderScan.ps1 has its own "press any key" prompt. This
:: pause is only a safety net for the case where PowerShell fails to start
:: the script at all (syntax error, missing file), which would otherwise
:: flash the window shut before the error could be read.
if errorlevel 1 (
    echo.
    echo The script exited with an error code above.
    pause
)
endlocal
```
