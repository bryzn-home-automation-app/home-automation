# Who's home: "Link this device". A phone on the home Wi-Fi opens
#   http://<nuc>:8099/identify?t=<token>
# (a one-time token from POST /api/presence/identify). This listener sees the phone's
# real LAN address, which Docker hides from the backend, looks up its MAC, and writes
# presence/identify/<token>.json for PresenceService to finish the link.
#
# Runs on the NUC host as a SYSTEM task started at boot (scripts/install-presence-task.cmd).
# Only answers devices on the LAN's /24, and the firewall rule allows only the local
# subnet.

$ErrorActionPreference = 'Stop'
$Port = 8099
$dir = Join-Path (Split-Path $PSScriptRoot -Parent) 'presence\identify'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function Get-Lan {
    $cfg = Get-NetIPConfiguration |
        Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
        Select-Object -First 1
    $self = @($cfg.IPv4Address)[0].IPAddress
    [pscustomobject]@{ IfIndex = $cfg.InterfaceIndex; Base = (($self -split '\.')[0..2] -join '.') }
}

function Send-Page($ctx, [int]$status, [string]$title, [string]$body) {
    $html = "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
        "<title>HomeOS</title><body style='font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;" +
        "text-align:center;background:#0b1220;color:#e5e7eb'><h1 style='font-size:1.4rem'>$title</h1><p>$body</p></body>"
    $bytes = [Text.Encoding]::UTF8.GetBytes($html)
    $ctx.Response.StatusCode = $status
    $ctx.Response.ContentType = 'text/html; charset=utf-8'
    $ctx.Response.Headers['Cache-Control'] = 'no-store'
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$Port/")
$listener.Start()

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
        # Forget links nobody finished.
        Get-ChildItem $dir -Filter *.json | Where-Object { $_.LastWriteTime -lt (Get-Date).AddMinutes(-10) } |
            Remove-Item -Force -ErrorAction SilentlyContinue

        $token = $ctx.Request.QueryString['t']
        if ($ctx.Request.Url.AbsolutePath -ne '/identify' -or $token -notmatch '^[A-Za-z0-9_-]{22,64}$') {
            Send-Page $ctx 404 'Not found' ''
            continue
        }
        $lan = Get-Lan
        $ip = $ctx.Request.RemoteEndPoint.Address.MapToIPv4().ToString()
        if (-not $ip.StartsWith("$($lan.Base).")) {
            Send-Page $ctx 403 'Not on the home Wi-Fi' 'Connect this device to the home Wi-Fi, then try again from HomeOS.'
            continue
        }
        # It just connected, so the NUC knows its MAC; ping once in case the entry aged out.
        $n = Get-NetNeighbor -InterfaceIndex $lan.IfIndex -IPAddress $ip -ErrorAction SilentlyContinue
        if (-not $n -or -not $n.LinkLayerAddress) {
            Test-Connection -ComputerName $ip -Count 1 -Quiet | Out-Null
            $n = Get-NetNeighbor -InterfaceIndex $lan.IfIndex -IPAddress $ip -ErrorAction SilentlyContinue
        }
        if (-not $n -or -not $n.LinkLayerAddress) {
            Send-Page $ctx 500 'Couldn''t identify this device' 'Try again in a minute.'
            continue
        }
        $out = [ordered]@{
            ip  = $ip
            mac = $n.LinkLayerAddress.ToLower().Replace('-', ':')
            at  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        }
        $file = Join-Path $dir "$token.json"
        [IO.File]::WriteAllText("$file.tmp", ($out | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
        Move-Item -Force "$file.tmp" $file
        Send-Page $ctx 200 'Device found' 'Go back to HomeOS to finish linking it. You can close this page.'
    } catch {
        try { Send-Page $ctx 500 'Something went wrong' 'Try again in a minute.' } catch { }
    }
}
