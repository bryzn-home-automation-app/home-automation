# Who's home: list the devices on the home Wi-Fi for the backend's PresenceService.
#
# Runs on the NUC itself, not in Docker: Docker Desktop's containers can't see the
# LAN's MAC addresses. A SYSTEM scheduled task runs it every minute (see
# scripts/install-presence-task.cmd). Each run forgets the LAN's cached neighbors,
# pings every address, and records the ones that answered: an ICMP reply, or an ARP
# reply (many phones ignore pings but still answer ARP). Forgetting first matters: a
# cached entry otherwise reads as present for a few seconds after a device has left.
#
# Output: presence/scan.json in the repo, bind-mounted into the backend at /presence.
#   { "scannedAt": "<UTC ISO>", "subnet": "192.168.4.0/24", "devices": [ { "mac", "ip", "pinged" } ] }

$ErrorActionPreference = 'Stop'

$outDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'presence'
$outFile = Join-Path $outDir 'scan.json'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# The LAN is the connected adapter with a default gateway (skips Tailscale, Hyper-V, WSL).
$cfg = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
    Select-Object -First 1
if (-not $cfg) { throw 'No connected network adapter with a default gateway' }
$ifIndex = $cfg.InterfaceIndex
$self = @($cfg.IPv4Address)[0].IPAddress
$base = ($self -split '\.')[0..2] -join '.'   # home networks are /24
$gateway = $cfg.IPv4DefaultGateway.NextHop

# Needs admin (the task runs as SYSTEM). The gateway entry stays so the NUC's own
# traffic never waits on re-resolving it.
Get-NetNeighbor -InterfaceIndex $ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -like "$base.*" -and $_.IPAddress -ne $gateway -and $_.State -ne 'Permanent' } |
    Remove-NetNeighbor -Confirm:$false -ErrorAction SilentlyContinue

$pings = foreach ($n in 1..254) {
    $ip = "$base.$n"
    if ($ip -eq $self) { continue }
    [pscustomobject]@{ Ip = $ip; Task = (New-Object System.Net.NetworkInformation.Ping).SendPingAsync($ip, 3000) }
}
try { [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($pings.Task)) } catch { }
Start-Sleep -Milliseconds 500   # let the last ARP replies land

$replied = @{}
foreach ($p in $pings) {
    if ($p.Task.Status -eq 'RanToCompletion' -and $p.Task.Result.Status -eq 'Success') { $replied[$p.Ip] = $true }
}

# The cache was emptied, so every resolved entry answered ARP during this run; one
# that didn't is Incomplete or Unreachable. (3 s covers Windows' ARP retries.)
$devices = Get-NetNeighbor -InterfaceIndex $ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $_.IPAddress -like "$base.*" -and $_.IPAddress -ne "$base.255" -and
        $_.LinkLayerAddress -and $_.LinkLayerAddress -notmatch '^(00-00-00-00-00-00|FF-FF-FF-FF-FF-FF|01-00-5E)' -and
        ($_.State -in 'Reachable', 'Stale', 'Delay', 'Probe' -or $replied.ContainsKey($_.IPAddress))
    } |
    ForEach-Object {
        [ordered]@{
            mac    = $_.LinkLayerAddress.ToLower().Replace('-', ':')
            ip     = $_.IPAddress
            pinged = $replied.ContainsKey($_.IPAddress)
        }
    }

$scan = [ordered]@{
    scannedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    subnet    = "$base.0/24"
    devices   = @($devices)
}

# Write then rename, so the backend never reads a half-written file.
$tmp = "$outFile.tmp"
[IO.File]::WriteAllText($tmp, ($scan | ConvertTo-Json -Depth 4 -Compress), (New-Object Text.UTF8Encoding $false))
Move-Item -Force $tmp $outFile
