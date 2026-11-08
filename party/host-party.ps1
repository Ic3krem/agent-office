# Host a TiroAgents party: starts the party server and its Cloudflare share link in Docker, then prints what to send
# your friends. Run it again any time to see the link. Stop the party with:  .\host-party.ps1 -Stop
# Needs Docker Desktop running. Right-click > Run with PowerShell, or: powershell -ExecutionPolicy Bypass -File host-party.ps1
param([switch]$Stop)
Set-Location $PSScriptRoot
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Write-Host 'Install Docker Desktop first: https://www.docker.com/products/docker-desktop/'; Read-Host 'Press Enter to close'; exit 1 }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Write-Host 'Start Docker Desktop, wait until it says it is running, then run this again.'; Read-Host 'Press Enter to close'; exit 1 }
if ($Stop) { docker compose down; Write-Host 'Party stopped.'; exit $LASTEXITCODE }

# A fixed invite code and host key (kept in .env next to this script), so a restart does not change them.
if (-not (Test-Path .env)) {
  $abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.ToCharArray(); $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $pick = { param($n) $b = New-Object byte[] $n; $rng.GetBytes($b); -join ($b | ForEach-Object { $abc[$_ % $abc.Length] }) }
  "PARTY_CODE=$(& $pick 6)`nPARTY_ADMIN_KEY=$(& $pick 24)`nPARTY_NAME=TiroAgents party`n" | Set-Content -Encoding ascii .env
}
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Read-Host 'Docker could not start the party. Press Enter to close'; exit 1 }

Write-Host 'Waiting for the share link (up to 90 s)...'
$link = $null
for ($i = 0; $i -lt 45 -and -not $link; $i++) {
  Start-Sleep 2
  $m = [regex]::Matches((docker compose logs --no-log-prefix party | Out-String), 'Share this link: (\S+)\s+with code (\S+)')
  if ($m.Count) { $link = $m[$m.Count - 1] }
}
$envs = @{}; Get-Content .env | ForEach-Object { if ($_ -match '^(\w+)=(.*)$') { $envs[$Matches[1]] = $Matches[2] } }
Write-Host ''
if ($link) {
  $msg = "Join my TiroAgents party: open TiroAgents > Party, paste $($link.Groups[1].Value) and code $($link.Groups[2].Value)"
  Write-Host "Share link : $($link.Groups[1].Value)"; Write-Host "Invite code: $($link.Groups[2].Value)"
  try { Set-Clipboard $msg; Write-Host '(A message with both is on your clipboard.)' } catch {}
} else {
  Write-Host "No share link yet (Cloudflare can be slow). Run this script again in a minute. Invite code: $($envs.PARTY_CODE)"
}
Write-Host "Host key (keep it private; it removes people): $($envs.PARTY_ADMIN_KEY)"
Write-Host 'The link changes each time the party restarts. Stop the party with: .\host-party.ps1 -Stop'
Read-Host 'Press Enter to close'
