# Starts the Agent Office server (if not already running) and opens the dashboard.
$cfg = Join-Path $env:USERPROFILE '.claude\agent-office\bridge.json'
$up = $false
try { Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4777/' -TimeoutSec 2 | Out-Null; $up = $true } catch {}
if (-not $up) {
  Start-Process node -ArgumentList 'server.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Minimized
  Start-Sleep -Seconds 2
}
$key = (Get-Content $cfg -Raw | ConvertFrom-Json).key
Start-Process "http://localhost:4777/?key=$key"
