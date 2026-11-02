# Agent Office installer for Windows. Use the script from the release tag you want to install (the tag is pinned in the URL):
#   irm https://raw.githubusercontent.com/Ic3krem/agent-office/v1.2.6/install.ps1 | iex
# What it does, and what it refuses to do:
#   1. downloads latest.json + latest.json.sig from THAT release tag over https (no "latest" lookup, no API),
#   2. verifies the Ed25519 signature of the manifest against the release public key pinned below (pure PowerShell, no extra tools),
#   3. downloads the installer named in the manifest (must be on this repository's release page) and checks its SHA-256,
#   4. runs it silently for the current user (no admin rights, no execution-policy change needed).
# Any failed check aborts before anything is installed.
# Verify a downloaded release folder without installing:  $env:AGENT_OFFICE_VERIFY_ONLY='C:\path\to\folder'; .\install.ps1
$ErrorActionPreference = 'Stop'
$repo = 'Ic3krem/agent-office'
$defaultTag = 'v1.2.6'   # bumped for every release so this script and the release it installs always match
$tag = if ($env:AGENT_OFFICE_TAG) { $env:AGENT_OFFICE_TAG } else { $defaultTag }
$PublicKeyBase64 = 'UOhtrcwZBBls13mV3jdJsk4V8xBZOB3cQNypRjN0Vcc='   # Ed25519 release key; same value as desktop/update-key.mjs
if ($tag -notmatch '^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw "Invalid release tag '$tag'." }

Add-Type -AssemblyName System.Numerics
function Mod([System.Numerics.BigInteger]$a, [System.Numerics.BigInteger]$m) { $r = [System.Numerics.BigInteger]::Remainder($a, $m); if ($r.Sign -lt 0) { $r += $m }; $r }
function ToBig([byte[]]$le) { New-Object System.Numerics.BigInteger (,([byte[]]($le + [byte]0))) }
$P = [System.Numerics.BigInteger]::Pow(2, 255) - 19
$L = [System.Numerics.BigInteger]::Pow(2, 252) + [System.Numerics.BigInteger]::Parse('27742317777372353535851937790883648493')
function Inv($a) { [System.Numerics.BigInteger]::ModPow((Mod $a $P), $P - 2, $P) }
$D = Mod ((-121665) * (Inv 121666)) $P
function PointAdd($p1, $p2) {
  $x1 = $p1[0]; $y1 = $p1[1]; $x2 = $p2[0]; $y2 = $p2[1]
  $t = Mod ($D * $x1 * $x2 * $y1 * $y2) $P
  $x3 = Mod (($x1 * $y2 + $x2 * $y1) * (Inv (1 + $t))) $P
  $y3 = Mod (($y1 * $y2 + $x1 * $x2) * (Inv (1 - $t))) $P
  , @($x3, $y3)
}
function PointMul([System.Numerics.BigInteger]$k, $pt) {
  $q = @([System.Numerics.BigInteger]0, [System.Numerics.BigInteger]1)
  $n = $pt
  while ($k.Sign -gt 0) {
    if (-not $k.IsEven) { $q = PointAdd $q $n }
    $n = PointAdd $n $n
    $k = [System.Numerics.BigInteger]::Divide($k, 2)
  }
  , $q
}
function DecodePoint([byte[]]$b) {
  $sign = ($b[31] -band 0x80) -ne 0
  $c = $b.Clone(); $c[31] = $c[31] -band 0x7f
  $y = ToBig $c
  if ($y -ge $P) { throw 'bad point' }
  $y2 = Mod ($y * $y) $P
  $x2 = Mod (($y2 - 1) * (Inv ($D * $y2 + 1))) $P
  $x = [System.Numerics.BigInteger]::ModPow($x2, ($P + 3) / 8, $P)
  if ((Mod ($x * $x - $x2) $P).Sign -ne 0) { $x = Mod ($x * [System.Numerics.BigInteger]::ModPow(2, ($P - 1) / 4, $P)) $P }
  if ((Mod ($x * $x - $x2) $P).Sign -ne 0) { throw 'bad point' }
  if ($x.IsEven -eq $sign) { $x = Mod ($P - $x) $P }
  , @($x, $y)
}
# RFC 8032 verify: [S]B == R + [H(R||A||M)]A
function Test-Ed25519([byte[]]$pub, [byte[]]$msg, [byte[]]$sig) {
  if ($pub.Length -ne 32 -or $sig.Length -ne 64) { return $false }
  try {
    $S = ToBig $sig[32..63]
    if ($S -ge $L) { return $false }
    $A = DecodePoint $pub; $R = DecodePoint $sig[0..31]
    $sha = [System.Security.Cryptography.SHA512]::Create()
    $h = Mod (ToBig ($sha.ComputeHash([byte[]]($sig[0..31] + $pub + $msg)))) $L
    $Bx = [System.Numerics.BigInteger]::Parse('15112221349535400772501151409588531511454012693041857206046113283949847762202')
    $By = [System.Numerics.BigInteger]::Parse('46316835694926478169428394003475163141307993866256225615783033603165251855960')
    $Bp = @($Bx, $By)
    $lhs = PointMul $S $Bp
    $rhs = PointAdd $R (PointMul $h $A)
    return ($lhs[0] -eq $rhs[0]) -and ($lhs[1] -eq $rhs[1])
  } catch { return $false }
}
function Assert-SignedManifest([string]$jsonPath, [string]$sigPath) {
  $sigText = ([System.IO.File]::ReadAllText($sigPath)).Trim()
  try { $sig = [Convert]::FromBase64String($sigText) } catch { throw 'The signature file is not valid base64; not installing.' }
  if (-not (Test-Ed25519 ([Convert]::FromBase64String($PublicKeyBase64)) ([System.IO.File]::ReadAllBytes($jsonPath)) $sig)) {
    throw 'The release manifest signature is INVALID for the pinned Agent Office release key. Not installing.'
  }
}

if ($env:AGENT_OFFICE_VERIFY_ONLY) {
  Assert-SignedManifest (Join-Path $env:AGENT_OFFICE_VERIFY_ONLY 'latest.json') (Join-Path $env:AGENT_OFFICE_VERIFY_ONLY 'latest.json.sig')
  Write-Host 'Signature verifies against the pinned release key.' -ForegroundColor Green
  return
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue) -and -not (Test-Path "$env:USERPROFILE\.local\bin\claude.exe")) {
  Write-Host 'Agent Office runs your agents with Claude Code, which is not installed yet.' -ForegroundColor Yellow
  Write-Host 'Install it first from https://claude.ai/install.ps1 (read it before running it), then run  claude  once to log in.'
}

$base = "https://github.com/$repo/releases/download/$tag/"
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('agent-office-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  Write-Host "Fetching the signed manifest for $tag..."
  foreach ($f in 'latest.json', 'latest.json.sig') {
    try { Invoke-WebRequest -Uri ($base + $f) -OutFile (Join-Path $work $f) -UseBasicParsing -MaximumRedirection 5 }
    catch { throw "Release $tag has no $f ($($_.Exception.Message)). Releases from before signed manifests cannot be installed by this script; download the installer from the release page instead." }
  }
  Assert-SignedManifest (Join-Path $work 'latest.json') (Join-Path $work 'latest.json.sig')
  Write-Host 'Manifest signature verified.'
  $m = Get-Content (Join-Path $work 'latest.json') -Raw | ConvertFrom-Json
  if ($m.schema -ne 1) { throw 'Unsupported manifest schema.' }
  if ("v$($m.version)" -ne $tag) { throw "Manifest is for version $($m.version), not $tag. Not installing." }
  $asset = @($m.assets | Where-Object { $_.platform -eq 'win32' -and (-not $_.arch -or $_.arch -eq 'x64') }) | Select-Object -First 1
  if (-not $asset) { throw "No Windows installer in release $tag." }
  if ($asset.sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'Manifest has no valid SHA-256 for the installer.' }
  if (-not ([string]$asset.url).StartsWith($base)) { throw 'Installer is not hosted on this release page; refusing.' }
  $name = [System.IO.Path]::GetFileName(([uri]$asset.url).AbsolutePath)
  if ($name -notmatch '^[\w.\- ]+\.exe$') { throw 'Unexpected installer file name.' }
  $out = Join-Path $work $name
  Write-Host "Downloading $name..."
  Invoke-WebRequest -Uri $asset.url -OutFile $out -UseBasicParsing -MaximumRedirection 5
  $got = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $asset.sha256.ToLower()) { throw "SHA-256 mismatch for ${name}: expected $($asset.sha256), got $got. Download discarded." }
  Write-Host "SHA-256 verified ($got)."
  Write-Host 'Installing (current user, no admin needed)...'
  Start-Process $out -ArgumentList '/S' -Wait   # silent install; it creates the Start menu and desktop shortcuts
} finally { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }

$exe = Get-ChildItem "$env:LOCALAPPDATA\Programs" -Recurse -Filter 'Agent Office.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) { Start-Process $exe.FullName; Write-Host "Done. Agent Office $tag is running, and there is a shortcut on your desktop." -ForegroundColor Green }
else { Write-Host 'Installed. Open Agent Office from the desktop shortcut.' -ForegroundColor Green }
