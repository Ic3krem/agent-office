# Agent Office installer for Windows:
#   irm https://raw.githubusercontent.com/Ic3krem/agent-office/main/install.ps1 | iex
# Downloads the latest release, installs it for the current user and adds a desktop shortcut.
$ErrorActionPreference = 'Stop'
$repo = 'Ic3krem/agent-office'

if (-not (Get-Command claude -ErrorAction SilentlyContinue) -and -not (Test-Path "$env:USERPROFILE\.local\bin\claude.exe")) {
  Write-Host 'Agent Office runs your agents with Claude Code, which is not installed yet.' -ForegroundColor Yellow
  Write-Host 'Install it first:  irm https://claude.ai/install.ps1 | iex   then run  claude  once to log in.'
}

Write-Host 'Finding the latest Agent Office release...'
$rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'agent-office-installer' }
$asset = $rel.assets | Where-Object { $_.name -like '*Setup*.exe' } | Select-Object -First 1
if (-not $asset) { throw "No Windows installer in release $($rel.tag_name)." }

$out = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB)) MB)..."
Invoke-WebRequest $asset.browser_download_url -OutFile $out -UseBasicParsing

Write-Host 'Installing (current user, no admin needed)...'
Start-Process $out -ArgumentList '/S' -Wait   # silent install; it creates the Start menu and desktop shortcuts
Remove-Item $out -ErrorAction SilentlyContinue

$exe = Get-ChildItem "$env:LOCALAPPDATA\Programs" -Recurse -Filter 'Agent Office.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) { Start-Process $exe.FullName; Write-Host "Done. Agent Office $($rel.tag_name) is running, and there is a shortcut on your desktop." -ForegroundColor Green }
else { Write-Host 'Installed. Open Agent Office from the desktop shortcut.' -ForegroundColor Green }
