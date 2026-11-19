# Resident load / game helper for the Tiro notch: prints one JSON line every 1500 ms, read by perf-monitor.mjs.
#   proc, pid  foreground window's process (lower-case base name without .exe, whitespace as '_'); window titles are never read
#   fg, monitor, max  its window rectangle, its monitor's rectangle, and whether it is maximized
#   cpu  total CPU load %, mem  memory in use (GB), gpu  GPU load % (busiest engine of the 3D GPU Engine counters, summed over processes as Task Manager does)
#   gpuTemp  GPU temperature (C) from nvidia-smi, only when it is on PATH; run at most every 3 s, killed after 2 s, never blocks a sample
# Missing values are null. Counters are opened once and reused; nvidia-smi is the only process started after the first sample. Exits when stdin closes.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Diagnostics; using System.Globalization; using System.Runtime.InteropServices; using System.Text;
public static class TiroPerf {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MEMSTATUS m);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder name, ref uint size);
  struct RECT { public int L, T, R, B; }
  struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  struct MEMSTATUS { public uint dwLength; public uint dwMemoryLoad; public ulong total, avail, totPage, availPage, totVirt, availVirt, availExt; }
  static readonly CultureInfo IC = CultureInfo.InvariantCulture;
  static PerformanceCounter cpu; static bool cpuPrimed;
  static PerformanceCounterCategory gpuCat; static Dictionary<string, CounterSample> gpuPrev = new Dictionary<string, CounterSample>();
  static uint lastPid; static string lastName;
  static string smi; static Process smiProc; static DateTime smiAt = DateTime.MinValue; static double tempVal = -1;

  public static void Init(string smiPath) {
    try { cpu = new PerformanceCounter("Processor Information", "% Processor Utility", "_Total", true); cpu.NextValue(); }
    catch { try { cpu = new PerformanceCounter("Processor", "% Processor Time", "_Total", true); cpu.NextValue(); } catch { cpu = null; } }
    try { if (PerformanceCounterCategory.Exists("GPU Engine")) gpuCat = new PerformanceCounterCategory("GPU Engine"); } catch { gpuCat = null; }
    smi = string.IsNullOrEmpty(smiPath) ? null : smiPath;
  }
  static string N(double v) { return Math.Round(v, 1).ToString("0.#", IC); }
  static string Rect(RECT r) { return "{\"x\":" + r.L + ",\"y\":" + r.T + ",\"w\":" + (r.R - r.L) + ",\"h\":" + (r.B - r.T) + "}"; }

  static string ProcName(uint pid) {
    if (pid == lastPid && lastName != null) return lastName;
    string path = null;
    IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
    if (h != IntPtr.Zero) { try { var sb = new StringBuilder(1024); uint n = 1024; if (QueryFullProcessImageName(h, 0, sb, ref n)) path = sb.ToString(); } finally { CloseHandle(h); } }
    string name = null;
    try { name = path != null ? System.IO.Path.GetFileNameWithoutExtension(path) : Process.GetProcessById((int)pid).ProcessName; } catch { }
    if (name != null) { name = System.Text.RegularExpressions.Regex.Replace(name.Trim().ToLowerInvariant(), "\\s+", "_"); if (!System.Text.RegularExpressions.Regex.IsMatch(name, "^[a-z0-9._-]{1,60}$")) name = null; }
    lastPid = pid; lastName = name; return name;
  }

  static string Gpu() {
    if (gpuCat == null) return "null";
    try {
      InstanceDataCollection col = gpuCat.ReadCategory()["utilization percentage"];
      if (col == null) return "null";
      var next = new Dictionary<string, CounterSample>(); var eng = new Dictionary<string, double>(); bool any = false;
      foreach (InstanceData d in col.Values) {
        string inst = d.InstanceName; if (!inst.EndsWith("engtype_3D", StringComparison.OrdinalIgnoreCase)) continue;
        next[inst] = d.Sample; CounterSample old;
        if (!gpuPrev.TryGetValue(inst, out old)) continue;
        int at = inst.IndexOf("luid_", StringComparison.Ordinal); string key = at >= 0 ? inst.Substring(at) : inst;
        double v = CounterSample.Calculate(old, d.Sample); double s; eng.TryGetValue(key, out s); eng[key] = s + v; any = true;
      }
      gpuPrev = next;
      if (!any) return "null";
      double max = 0; foreach (double v in eng.Values) if (v > max) max = v;
      return N(Math.Min(100, Math.Max(0, max)));
    } catch { return "null"; }
  }

  static void Smi() {
    if (smi == null) return;
    try {
      if (smiProc != null) {
        if (smiProc.HasExited) {
          double best = -1; string outp = smiProc.StandardOutput.ReadToEnd();
          if (smiProc.ExitCode == 0) foreach (string l in outp.Split('\n')) { double t; if (double.TryParse(l.Trim(), NumberStyles.Float, IC, out t) && t > best) best = t; }
          tempVal = best; smiProc.Dispose(); smiProc = null;
        } else if ((DateTime.UtcNow - smiAt).TotalMilliseconds > 2000) { try { smiProc.Kill(); } catch { } smiProc.Dispose(); smiProc = null; tempVal = -1; }
        return;
      }
      if ((DateTime.UtcNow - smiAt).TotalMilliseconds < 3000) return;
      smiAt = DateTime.UtcNow;
      var si = new ProcessStartInfo(smi, "--query-gpu=temperature.gpu --format=csv,noheader,nounits") { UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true };
      smiProc = Process.Start(si);
    } catch { tempVal = -1; if (smiProc != null) { try { smiProc.Dispose(); } catch { } smiProc = null; } }
  }

  public static string Line() {
    var sb = new StringBuilder("{");
    string proc = "null", pid = "null", fg = "null", mon = "null", max = "false";
    try {
      IntPtr w = GetForegroundWindow();
      if (w != IntPtr.Zero) {
        uint p; GetWindowThreadProcessId(w, out p);
        if (p != 0) { pid = p.ToString(IC); string n = ProcName(p); if (n != null) proc = "\"" + n + "\""; }
        RECT r; if (GetWindowRect(w, out r)) fg = Rect(r);
        max = IsZoomed(w) ? "true" : "false";
        IntPtr m = MonitorFromWindow(w, 2); // MONITOR_DEFAULTTONEAREST
        var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        if (m != IntPtr.Zero && GetMonitorInfo(m, ref mi)) mon = Rect(mi.rcMonitor);
      }
    } catch { }
    string c = "null";
    try { if (cpu != null) { float v = cpu.NextValue(); if (cpuPrimed) c = N(Math.Min(100, Math.Max(0, v))); cpuPrimed = true; } } catch { }
    string mem = "null";
    try { var ms = new MEMSTATUS(); ms.dwLength = (uint)Marshal.SizeOf(typeof(MEMSTATUS)); if (GlobalMemoryStatusEx(ref ms)) mem = N((ms.total - ms.avail) / 1073741824.0); } catch { }
    string g = Gpu();
    Smi();
    sb.Append("\"proc\":").Append(proc).Append(",\"pid\":").Append(pid).Append(",\"fg\":").Append(fg).Append(",\"monitor\":").Append(mon).Append(",\"max\":").Append(max)
      .Append(",\"cpu\":").Append(c).Append(",\"mem\":").Append(mem).Append(",\"gpu\":").Append(g).Append(",\"gpuTemp\":").Append(tempVal >= 0 && tempVal <= 150 ? N(tempVal) : "null").Append("}");
    return sb.ToString();
  }
}
'@
$smi = $null
try { $smi = (Get-Command nvidia-smi.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source } catch { }
[TiroPerf]::Init($smi)
$stdin = [Console]::OpenStandardInput(); $rbuf = New-Object byte[] 64; $eof = $stdin.ReadAsync($rbuf, 0, 64)
while ($true) {
  if ($eof.IsCompleted) { if ($eof.Result -le 0) { exit 0 }; $eof = $stdin.ReadAsync($rbuf, 0, 64) }  # parent gone: stop; anything written is ignored
  [Console]::Out.WriteLine([TiroPerf]::Line()); [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1500
}
