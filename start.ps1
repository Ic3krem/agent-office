# Starts the Agent Office server from this folder (development; the desktop app starts its own).
# The server picks port 4777, or the next free one when another program holds it, and writes the port to bridge.json.
# Its window prints a one-time sign-in link (valid 5 minutes); no key is put in a URL or a file.
$cfg = Join-Path $env:USERPROFILE '.claude\agent-office\bridge.json'
$port = try { (Get-Content $cfg -Raw | ConvertFrom-Json).port } catch { $null }
if ($port) {
  # an anonymous request is answered 401, which still carries the x-agent-office header
  # keep the response object: a header collection assigned on its own would be unrolled into its key names
  $resp = try { Invoke-WebRequest -UseBasicParsing -Method Head -Uri "http://127.0.0.1:$port/" -TimeoutSec 2 } catch { $_.Exception.Response }
  if ($resp -and $resp.Headers['x-agent-office']) { Write-Host "Agent Office is already running on port $port."; exit }
}
Start-Process node -ArgumentList 'server.mjs' -WorkingDirectory $PSScriptRoot
