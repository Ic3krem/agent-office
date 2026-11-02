# Resident SMTC poller for the Tiro island: prints one JSON line per change (or "null" when no media session exists).
# Reads GlobalSystemMediaTransportControlsSessionManager, so Spotify, Apple Music, browsers (YouTube) and any SMTC player show up.
# Also emits pos/dur/ts (SMTC timeline) so the island can show synced lyrics.
# Commands arrive on stdin, one per line: "playpause|next|prev <session id>".
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Wait($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(4000) | Out-Null; $t.Result }
$mgr = Wait ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$stdin = [Console]::OpenStandardInput(); $rbuf = New-Object byte[] 512; $cmdTask = $stdin.ReadAsync($rbuf, 0, 512); $pending = ''
$lastJson = ''; $lastTick = 0
while ($true) {
  while ($cmdTask.IsCompleted) {
    $n = $cmdTask.Result
    if ($n -le 0) { exit 0 }  # parent closed stdin
    $pending += [Text.Encoding]::UTF8.GetString($rbuf, 0, $n)
    $cmdTask = $stdin.ReadAsync($rbuf, 0, 512)
    while ($pending.Contains("`n")) {
    $i = $pending.IndexOf("`n"); $line = $pending.Substring(0, $i); $pending = $pending.Substring($i + 1)
    $p = $line.Trim() -split ' ', 2
    if ($p.Count -eq 2) {
      $s = $mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -eq $p[1] } | Select-Object -First 1
      if ($s) {
        try {
          if ($p[0] -eq 'playpause') { $null = $s.TryTogglePlayPauseAsync() } elseif ($p[0] -eq 'next') { $null = $s.TrySkipNextAsync() } elseif ($p[0] -eq 'prev') { $null = $s.TrySkipPreviousAsync() }
        } catch {}
      }
    }
    }
  }
  $out = 'null'
  try {
    $all = @($mgr.GetSessions())
    $cur = $mgr.GetCurrentSession()
    $order = @($all | Where-Object { $_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' })
    $order = @($order | Where-Object { $_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' }) + @($cur) + @($all)
    $seen = @{}
    foreach ($pick in $order) {
      if (-not $pick -or $seen[$pick.SourceAppUserModelId]) { continue }
      $seen[$pick.SourceAppUserModelId] = 1
      $pi = $pick.GetPlaybackInfo(); $c = $pi.Controls
      $m = Wait ($pick.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      if (-not ($m.Title -or $m.Artist)) { continue }  # skip sessions with nothing to show (e.g. idle apps)
      # Timeline anchor: Position as of LastUpdatedTime (epoch ms); the page extrapolates while playing. Players with no timeline give nulls.
      $pos = $null; $dur = $null; $ts = $null
      try {
        $tl = $pick.GetTimelineProperties(); $d = ($tl.EndTime - $tl.StartTime).TotalMilliseconds
        $u = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
        if ($d -gt 0 -and $u -gt 946684800000) { $pos = [int64][math]::Round($tl.Position.TotalMilliseconds); $dur = [int64][math]::Round($d); $ts = if ([string]$pi.PlaybackStatus -eq 'Playing') { [int64]$u } else { [int64]0 } }  # paused: the anchor time is irrelevant, keep the line stable
      } catch {}
      $out = [ordered]@{ id = $pick.SourceAppUserModelId; status = [string]$pi.PlaybackStatus; title = [string]$m.Title; artist = [string]$m.Artist; album = [string]$m.AlbumTitle
        canPlayPause = [bool]($c.IsPlayEnabled -or $c.IsPauseEnabled); canNext = [bool]$c.IsNextEnabled; canPrev = [bool]$c.IsPreviousEnabled; pos = $pos; dur = $dur; ts = $ts } | ConvertTo-Json -Compress
      break
    }
  } catch { $out = 'null' }
  if ($out -ne $lastJson) { [Console]::Out.WriteLine($out); [Console]::Out.Flush(); $lastJson = $out }
  Start-Sleep -Milliseconds 700
}
