# NUC health: the host's CPU, memory, disks, temperatures, network, power events and
# containers, for the backend's HostMetricsService (Admin → NUC Health).
#
# Runs on the NUC itself, not in Docker: a container only sees Docker Desktop's Linux VM,
# not the Windows machine. A SYSTEM scheduled task runs it every minute (see
# scripts/install-host-metrics-task.cmd). Rates (CPU, disk and network throughput, each
# process's CPU) are averages since the previous run, from cumulative counters kept in
# state.json, so each sample covers the whole minute rather than one instant.
#
# Each section is collected on its own: one that fails is left out and named in
# agent.errors, and the rest still report. Docker gets a time limit, since a wedged Docker
# Desktop can leave the CLI waiting forever.
#
# Output: host-metrics/metrics.json in the repo, bind-mounted into the backend at
# /host-metrics. -OutDir writes somewhere else (for trying it by hand).

param([string]$OutDir)

$ErrorActionPreference = 'Stop'
$started = [Diagnostics.Stopwatch]::StartNew()

if (-not $OutDir) { $OutDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'host-metrics' }
$outFile = Join-Path $OutDir 'metrics.json'
$stateFile = Join-Path $OutDir 'state.json'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$now = (Get-Date).ToUniversalTime()
$errors = New-Object System.Collections.Generic.List[string]
$prev = $null
if (Test-Path $stateFile) { try { $prev = Get-Content $stateFile -Raw | ConvertFrom-Json } catch { } }
$state = [ordered]@{ at = $now.ToString('o') }

# Seconds since the previous run; rates need it. Missing or over 15 minutes old: no rates
# this time (the counters may also have reset with a reboot).
$elapsed = $null
if ($prev -and $prev.at) {
    $e = ($now - [datetime]::Parse($prev.at).ToUniversalTime()).TotalSeconds
    if ($e -ge 5 -and $e -le 900) { $elapsed = $e }
}

function Iso($d) { if ($d) { ([datetime]$d).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } else { $null } }
function Round1($v) { if ($null -eq $v) { $null } else { [math]::Round([double]$v, 1) } }
# A per-second rate from two readings of a counter that only grows; null across a reset.
function Rate($cur, $old) {
    if ($null -eq $elapsed -or $null -eq $old -or $null -eq $cur) { return $null }
    $d = [double]([decimal]"$cur" - [decimal]"$old")
    if ($d -lt 0) { return $null }
    [math]::Round($d / $elapsed, 1)
}
$timings = [ordered]@{}
function Section([string]$name, [scriptblock]$block) {
    $t = [Diagnostics.Stopwatch]::StartNew()
    try { & $block } catch { $errors.Add("${name}: $($_.Exception.Message)"); $null }
    $timings[$name] = $t.ElapsedMilliseconds
}

# Slow sections that rarely change (SSD health, which adapter is the LAN, the event log) are
# read every few minutes and carried over in state.json in between, so the monitor itself
# stays light: each one costs a second or two of CIM queries. A different $key (a new boot)
# reads again at once.
$state.cache = @{}
function Cached([string]$name, [int]$minutes, [string]$key, [scriptblock]$block) {
    $c = if ($prev -and $prev.cache) { $prev.cache.$name } else { $null }
    if ($c -and $c.at -and "$($c.key)" -eq $key -and ($now - [datetime]::Parse($c.at).ToUniversalTime()).TotalMinutes -lt $minutes) {
        $state.cache[$name] = $c
        return $c.value
    }
    $v = Section $name $block
    if ($null -ne $v) { $state.cache[$name] = @{ at = $now.ToString('o'); key = $key; value = $v } }
    $v
}

$os = Get-CimInstance Win32_OperatingSystem
$processor = @(Get-CimInstance Win32_Processor)[0]   # slow (~1 s): ask once

$hostInfo = Section 'host' {
    $cs = Get-CimInstance Win32_ComputerSystem
    $cpu = $processor
    [ordered]@{
        name              = $env:COMPUTERNAME
        model             = "$($cs.Manufacturer) $($cs.Model)".Trim()
        os                = $os.Caption
        osBuild           = "$($os.Version)"
        cpuModel          = ($cpu.Name -replace '\s+', ' ').Trim()
        cores             = [int]$cpu.NumberOfCores
        logicalProcessors = [int]$cpu.NumberOfLogicalProcessors
        bootTime          = Iso $os.LastBootUpTime
    }
}
$logical = if ($hostInfo) { [int]$hostInfo.logicalProcessors } else { [Environment]::ProcessorCount }

# _Total's raw counter is idle time, already averaged over the processors.
$cpuInfo = Section 'cpu' {
    $raw = Get-CimInstance Win32_PerfRawData_PerfOS_Processor -Filter "Name='_Total'"
    $state.cpu = @{ idle = [string]$raw.PercentProcessorTime; ts = [string]$raw.Timestamp_Sys100NS }
    $usage = $null
    if ($elapsed -and $prev.cpu) {
        $dTs = [double]([decimal]"$($raw.Timestamp_Sys100NS)" - [decimal]"$($prev.cpu.ts)")
        $dIdle = [double]([decimal]"$($raw.PercentProcessorTime)" - [decimal]"$($prev.cpu.idle)")
        if ($dTs -gt 0 -and $dIdle -ge 0) { $usage = [math]::Max(0, [math]::Min(100, 100 * (1 - $dIdle / $dTs))) }
    }
    [ordered]@{ usagePct = Round1 $usage; clockMhz = [int]$processor.CurrentClockSpeed; maxClockMhz = [int]$processor.MaxClockSpeed }
}

$memory = Section 'memory' {
    [ordered]@{
        totalBytes       = [int64]$os.TotalVisibleMemorySize * 1KB
        availableBytes   = [int64]$os.FreePhysicalMemory * 1KB
        commitBytes      = ([int64]$os.TotalVirtualMemorySize - [int64]$os.FreeVirtualMemory) * 1KB
        commitLimitBytes = [int64]$os.TotalVirtualMemorySize * 1KB
    }
}

$disks = Section 'disks' {
    $io = @{}
    foreach ($r in Get-CimInstance Win32_PerfRawData_PerfDisk_LogicalDisk) { $io[$r.Name] = $r }
    $state.disks = @{}
    @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
        $r = $io[$_.DeviceID]
        $old = if ($prev.disks) { $prev.disks.($_.DeviceID) } else { $null }
        if ($r) { $state.disks[$_.DeviceID] = @{ read = [string]$r.DiskReadBytesPersec; write = [string]$r.DiskWriteBytesPersec } }
        [ordered]@{
            name       = $_.DeviceID
            label      = $_.VolumeName
            totalBytes = [int64]$_.Size
            freeBytes  = [int64]$_.FreeSpace
            readBps    = if ($r -and $old) { Rate $r.DiskReadBytesPersec $old.read } else { $null }
            writeBps   = if ($r -and $old) { Rate $r.DiskWriteBytesPersec $old.write } else { $null }
        }
    })
}

# Needs admin (the task runs as SYSTEM): SMART-style temperature and wear. Every 10 minutes.
$physicalDisks = Cached 'physicalDisks' 10 '' {
    @(Get-PhysicalDisk | ForEach-Object {
        $rel = try { $_ | Get-StorageReliabilityCounter } catch { $null }
        [ordered]@{
            name         = $_.FriendlyName
            mediaType    = "$($_.MediaType)"
            sizeBytes    = [int64]$_.Size
            health       = "$($_.HealthStatus)"
            temperatureC = if ($rel -and $rel.Temperature) { [double]$rel.Temperature } else { $null }
            wearPct      = if ($rel -and $null -ne $rel.Wear) { [double]$rel.Wear } else { $null }
            powerOnHours = if ($rel -and $rel.PowerOnHours) { [int64]$rel.PowerOnHours } else { $null }
        }
    })
}

# ACPI thermal zones, in tenths of a kelvin. Some report placeholders (-263 °C); keep
# readings a running machine could have.
$temperatures = Section 'temperatures' {
    @(Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation | ForEach-Object {
        $c = [math]::Round($_.HighPrecisionTemperature / 10 - 273.15, 1)
        if ($c -gt 5 -and $c -lt 125) { [ordered]@{ name = ($_.Name -replace '^\\_?', ''); celsius = $c } }
    })
}

# The LAN is the connected adapter with the default route (skips Tailscale, Hyper-V, WSL).
# Which one it is (and its address) is looked up every 10 minutes; its traffic every run.
# (Get-NetIPConfiguration finds the same but takes ~4 s.)
$nic = Cached 'nic' 10 '' {
    $adapter = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric |
        ForEach-Object { Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue } |
        Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1
    if (-not $adapter) { throw 'No connected network adapter with a default route' }
    $ip = Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
    $tailscale = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceDescription -like 'Tailscale*' } | Select-Object -First 1
    [ordered]@{
        name        = $adapter.Name
        description = $adapter.InterfaceDescription
        linkMbps    = [math]::Round($adapter.ReceiveLinkSpeed / 1e6)
        ip          = if ($ip) { $ip.IPAddress } else { $null }
        tailscaleUp = [bool]($tailscale -and $tailscale.Status -eq 'Up')
    }
}
$network = Section 'network' {
    if (-not $nic) { throw 'No connected network adapter with a default route' }
    $stats = Get-NetAdapterStatistics -Name $nic.name
    $state.net = @{ rx = [string]$stats.ReceivedBytes; tx = [string]$stats.SentBytes; adapter = $nic.name }
    $sameAdapter = $prev.net -and $prev.net.adapter -eq $nic.name
    $wifi = $null
    if ($nic.description -match 'Wi-?Fi|Wireless|802\.11') {
        $w = @{}
        foreach ($line in (netsh wlan show interfaces)) {
            if ($line -match '^\s*([^:]+?)\s*:\s*(.*?)\s*$') { if (-not $w.ContainsKey($Matches[1])) { $w[$Matches[1]] = $Matches[2] } }
        }
        $num = { param($s) if ($s -match '-?\d+(\.\d+)?') { [double]$Matches[0] } else { $null } }
        $wifi = [ordered]@{
            ssid      = $w['SSID']
            signalPct = & $num $w['Signal']
            rssi      = & $num $w['Rssi']
            band      = $w['Band']
            channel   = $w['Channel']
            radio     = $w['Radio type']
            rxMbps    = & $num $w['Receive rate (Mbps)']
            txMbps    = & $num $w['Transmit rate (Mbps)']
        }
    }
    [ordered]@{
        adapter     = $nic.name
        description = $nic.description
        linkMbps    = $nic.linkMbps
        ip          = $nic.ip
        rxBps       = if ($sameAdapter) { Rate $stats.ReceivedBytes $prev.net.rx } else { $null }
        txBps       = if ($sameAdapter) { Rate $stats.SentBytes $prev.net.tx } else { $null }
        wifi        = $wifi
        tailscaleUp = $nic.tailscaleUp
    }
}

$power = Section 'power' {
    $plan = if ((powercfg /getactivescheme) -match '\(([^)]+)\)') { $Matches[1] } else { $null }
    $sleep = $null
    $q = powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String 'Current AC Power Setting Index:\s*0x([0-9a-fA-F]+)'
    if ($q) { $sleep = [int]([Convert]::ToInt32($q.Matches[0].Groups[1].Value, 16) / 60) }
    $pending = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') -or
               (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending')
    [ordered]@{ plan = $plan; sleepAfterMinutes = $sleep; pendingReboot = [bool]$pending }
}

# Restarts, shutdowns and sleep over the last 30 days, newest first: what happened when the
# NUC went quiet. 41/6008 = it lost power or froze; 1074 = something asked it to restart.
# Every 10 minutes, and straight away after a restart (the boot time is the key).
$events = Cached 'events' 10 "$(if ($hostInfo) { $hostInfo.bootTime })" {
    $kinds = @{ 41 = 'unexpected'; 6008 = 'unexpected'; 1074 = 'restart'; 6005 = 'boot'; 6006 = 'shutdown'; 42 = 'sleep'; 1 = 'wake' }
    $since = $now.AddDays(-30).ToLocalTime()
    # Event 1 means "woke from sleep" only from Power-Troubleshooter (others log 1 for time changes).
    $found = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 41, 6008, 1074, 6005, 6006, 42; StartTime = $since } -MaxEvents 20 -ErrorAction SilentlyContinue) +
             @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Power-Troubleshooter'; Id = 1; StartTime = $since } -MaxEvents 20 -ErrorAction SilentlyContinue)
    @($found | Where-Object { $_ } | Sort-Object TimeCreated -Descending | Select-Object -First 20 | ForEach-Object {
            $kind = $kinds[$_.Id]
            # Windows puts invisible left-to-right marks around the digits of a date.
            # (Literal characters: PowerShell 5.1 -replace ignores a backslash-u escape inside [...].)
            $msg = ($_.Message -replace "[$([char]0x200E)$([char]0x200F)]", '' -replace '\s+', ' ').Trim()
            if ($_.Id -eq 1074 -and $msg -match 'Shutdown Type:\s*power off') { $kind = 'shutdown' }
            if ($msg.Length -gt 300) { $msg = $msg.Substring(0, 300) }
            [ordered]@{ at = Iso $_.TimeCreated; id = $_.Id; kind = $kind; message = $msg }
        })
}

# Grouped by name ("Docker Desktop" is six processes). CPU is the share of the whole machine
# since the last run.
$processes = Section 'processes' {
    $state.procs = @{}
    $prevProcs = @{}
    if ($prev.procs) { foreach ($pp in $prev.procs.PSObject.Properties) { $prevProcs[$pp.Name] = [double]$pp.Value } }
    $groups = @{}
    foreach ($p in Get-Process) {
        $cpuSec = $p.CPU
        $pct = 0
        if ($null -ne $cpuSec) {
            $state.procs["$($p.Id)"] = [math]::Round($cpuSec, 2)
            $old = $prevProcs["$($p.Id)"]
            if ($elapsed -and $null -ne $old -and $cpuSec -ge $old) { $pct = ($cpuSec - $old) / $elapsed / $logical * 100 }
        }
        $g = $groups[$p.ProcessName]
        if (-not $g) { $g = @{ count = 0; cpu = 0.0; mem = [int64]0 }; $groups[$p.ProcessName] = $g }
        $g.count++; $g.cpu += $pct; $g.mem += [int64]$p.WorkingSet64
    }
    $rows = $groups.GetEnumerator() | ForEach-Object {
        [ordered]@{ name = $_.Key; count = $_.Value.count; cpuPct = Round1 $_.Value.cpu; memBytes = $_.Value.mem }
    }
    @{
        topCpu    = @($rows | Where-Object { $_.name -ne 'Idle' } | Sort-Object { $_.cpuPct } -Descending | Select-Object -First 6)
        topMemory = @($rows | Sort-Object { $_.memBytes } -Descending | Select-Object -First 6)
    }
}

# ── Docker ──────────────────────────────────────────────────────────────────────────────
# SYSTEM doesn't have the owner's PATH, so find the CLI where Docker Desktop installs it.
function Find-Docker {
    $c = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    $candidates = @("$env:ProgramFiles\Docker\Docker\resources\bin\docker.exe") +
        @(Get-ChildItem 'C:\Users\*\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe' -ErrorAction SilentlyContinue | ForEach-Object FullName)
    $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

# Runs the CLI with a time limit; returns its stdout lines, or throws with its error.
function Invoke-Docker([string]$exe, [string]$arguments, [int]$timeoutSec) {
    $psi = New-Object Diagnostics.ProcessStartInfo $exe, "--host npipe:////./pipe/dockerDesktopLinuxEngine $arguments"
    $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
    $proc = [Diagnostics.Process]::Start($psi)
    $out = $proc.StandardOutput.ReadToEndAsync(); $err = $proc.StandardError.ReadToEndAsync()
    if (-not $proc.WaitForExit($timeoutSec * 1000)) {
        try { $proc.Kill() } catch { }
        throw "no answer from Docker within $timeoutSec s"
    }
    if ($proc.ExitCode -ne 0) {
        $msg = ($err.Result + ' ' + $out.Result).Trim() -replace '\s+', ' '
        if ($msg.Length -gt 240) { $msg = $msg.Substring(0, 240) }
        throw $msg
    }
    @($out.Result -split "`r?`n" | Where-Object { $_.Trim() })
}

# "279MiB / 6.772GiB" → bytes of the first figure (or the second with -Second).
function Parse-Size([string]$s, [switch]$Second) {
    $part = ($s -split '/')[[int][bool]$Second].Trim()
    if ($part -notmatch '^([\d.]+)\s*([KMGT]?i?B)$') { return $null }
    $mult = @{ B = 1; KB = 1e3; MB = 1e6; GB = 1e9; TB = 1e12; KiB = 1KB; MiB = 1MB; GiB = 1GB; TiB = 1TB }[$Matches[2]]
    [int64]([double]$Matches[1] * $mult)
}

$docker = Section 'docker' {
    $exe = Find-Docker
    if (-not $exe) { return [ordered]@{ ok = $false; error = 'Docker CLI not found'; containers = @() } }
    try {
        # Version, CPUs and memory barely change: ask once an hour.
        $info = $prev.dockerInfo
        if (-not $info -or -not $info.at -or ($now - [datetime]::Parse($info.at).ToUniversalTime()).TotalMinutes -ge 60) {
            $line = (Invoke-Docker $exe "info --format ""{{.ServerVersion}}|{{.NCPU}}|{{.MemTotal}}""" 15)[0]
            $f = $line -split '\|'
            $info = @{ at = $now.ToString('o'); version = $f[0]; cpus = [int]$f[1]; mem = [string]$f[2] }
        }
        $state.dockerInfo = $info
        $list = Invoke-Docker $exe "ps -a --no-trunc --format ""{{json .}}""" 20 | ForEach-Object { $_ | ConvertFrom-Json }
        $usage = @{}
        if (@($list | Where-Object State -eq 'running').Count) {
            foreach ($s in (Invoke-Docker $exe "stats --no-stream --format ""{{json .}}""" 30 | ForEach-Object { $_ | ConvertFrom-Json })) { $usage[$s.Name] = $s }
        }
        $cpus = [math]::Max(1, [int]$info.cpus)
        [ordered]@{
            ok            = $true
            error         = $null
            version       = $info.version
            cpus          = [int]$info.cpus
            memTotalBytes = [int64]$info.mem
            containers    = @($list | ForEach-Object {
                $u = $usage[$_.Names]
                # Compose's labels, as Docker Desktop groups by them (project) and names each row (service).
                $project = if ($_.Labels -match '(?:^|,)com\.docker\.compose\.project=([^,]+)') { $Matches[1] } else { $null }
                $service = if ($_.Labels -match '(?:^|,)com\.docker\.compose\.service=([^,]+)') { $Matches[1] } else { $null }
                $health = if ($_.Status -match '\((healthy|unhealthy|health: starting)\)') { $Matches[1] -replace 'health: ', '' } else { $null }
                [ordered]@{
                    name          = $_.Names
                    project       = $project
                    service       = $service
                    image         = $_.Image
                    state         = $_.State
                    status        = $_.Status
                    health        = $health
                    # docker stats counts one CPU as 100%; this is the share of all of them.
                    cpuPct        = if ($u) { Round1 ([double]($u.CPUPerc -replace '%', '') / $cpus) } else { $null }
                    memBytes      = if ($u) { Parse-Size $u.MemUsage } else { $null }
                    memLimitBytes = if ($u) { Parse-Size $u.MemUsage -Second } else { $null }
                }
            })
        }
    } catch {
        [ordered]@{ ok = $false; error = "$($_.Exception.Message)"; containers = @() }
    }
}

$metrics = [ordered]@{
    collectedAt     = $now.ToString('yyyy-MM-ddTHH:mm:ssZ')
    intervalSeconds = Round1 $elapsed
    host            = $hostInfo
    cpu             = $cpuInfo
    memory          = $memory
    disks           = @($disks | Where-Object { $null -ne $_ })
    physicalDisks   = @($physicalDisks | Where-Object { $null -ne $_ })
    temperatures    = @($temperatures | Where-Object { $null -ne $_ })
    network         = $network
    power           = $power
    events          = @($events | Where-Object { $null -ne $_ })
    topCpu          = if ($processes) { $processes.topCpu } else { @() }
    topMemory       = if ($processes) { $processes.topMemory } else { @() }
    docker          = $docker
    agent           = [ordered]@{ version = 2; durationMs = $started.ElapsedMilliseconds; sectionMs = $timings; errors = @($errors) }
}

# Write then rename, so the backend never reads a half-written file.
$utf8 = New-Object Text.UTF8Encoding $false
[IO.File]::WriteAllText("$stateFile.tmp", ($state | ConvertTo-Json -Depth 8 -Compress), $utf8)
Move-Item -Force "$stateFile.tmp" $stateFile
[IO.File]::WriteAllText("$outFile.tmp", ($metrics | ConvertTo-Json -Depth 6 -Compress), $utf8)
Move-Item -Force "$outFile.tmp" $outFile
