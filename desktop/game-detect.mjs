// Game mode for the notch: is the foreground app a game, and the perf helper's (perf.ps1) output validated. Pure, no electron import.
// Process names are executable base names, lower case, without .exe; whitespace becomes '_' (perf.ps1 and gameName do the same).

// Never a game, even covering the whole monitor: browsers, video and photo viewers, launchers, meeting, remote-desktop and VM windows,
// presentations and editors, the shell, and this app.
export const IGNORE = [
  'acrobat', 'acrord32', 'anydesk', 'applicationframehost', 'arc', 'battle.net', 'brave', 'chrome', 'code', 'eadesktop', 'electron', 'epicgameslauncher',
  'explorer', 'firefox', 'galaxyclient', 'iexplore', 'lockapp', 'microsoft.media.player', 'microsoft.photos', 'mpc-be64', 'mpc-hc64', 'mpv',
  'ms-teams', 'msedge', 'msrdc', 'mstsc', 'obs64', 'opera', 'origin', 'photos', 'potplayermini64', 'powerpnt', 'riotclientservices', 'riotclientux',
  'searchhost', 'shellexperiencehost', 'soffice.bin', 'startmenuexperiencehost', 'steam', 'steamwebhelper', 'teams', 'teamviewer', 'textinputhost',
  'tiroagents', 'ubisoftconnect', 'upc', 'video.ui', 'virtualboxvm', 'vivaldi', 'vlc', 'vmconnect', 'vmware', 'windowsterminal', 'wmplayer',
  'xboxpcapp', 'zoom',
];
// A game even in a window. Launch targets (the process that draws), not launchers. Users add their own in settings.
export const KNOWN_GAMES = [
  'bg3', 'bg3_dx11', 'cities', 'cod', 'cs2', 'cyberpunk2077', 'destiny2', 'diablo_iv', 'dota2', 'eldenring',
  'escapefromtarkov', 'fallout4', 'fortniteclient-win64-shipping', 'forzahorizon5', 'genshinimpact', 'gta5', 'helldivers2', 'hogwartslegacy', 'league_of_legends', 'minecraft.windows',
  'overwatch', 'palworld-win64-shipping', 'pathofexile', 'r5apex', 'r5apex_dx12', 'rainbowsix', 'rdr2', 'rocketleague', 'rustclient', 'sekiro',
  'skyrimse', 'starfield', 'terraria', 'tslgame', 'valorant-win64-shipping', 'warframe.x64', 'witcher3', 'wow',
];

const covers = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
// A game: on the known or the user's list; or not ignored and its window covers its whole monitor (a maximized window does not count:
// with an auto-hide taskbar every maximized window would). sample = parsePerfLine() output.
export function isGame(sample, { games = [] } = {}) {
  const proc = sample && sample.proc;
  if (!proc) return false;
  if (KNOWN_GAMES.includes(proc) || (Array.isArray(games) && games.includes(proc))) return true;
  if (IGNORE.includes(proc) || sample.max === true || !sample.fg || !sample.monitor) return false;
  return covers(sample.fg, sample.monitor);
}

// ---------- perf.ps1 output: untrusted input to main ----------
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const rect = r => {
  if (!r || typeof r !== 'object') return null;
  const o = { x: int(r.x, -1e6, 1e6), y: int(r.y, -1e6, 1e6), w: int(r.w, 0, 1e6), h: int(r.h, 0, 1e6) };
  return Object.values(o).includes(null) ? null : o;
};
// One JSON line per sample -> { proc, pid, fg, monitor, max, cpu, mem, gpu, gpuTemp }, or null for a line that is not a JSON object
// (or longer than 2 KB). Each field is checked on its own: a missing or invalid value is null, never 0.
export function parsePerfLine(line) {
  const s = String(line ?? '');
  if (s.length > 2048) return null;
  let j; try { j = JSON.parse(s); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  return {
    proc: typeof j.proc === 'string' && /^[a-z0-9._-]{1,60}$/.test(j.proc) ? j.proc : null,
    pid: int(j.pid, 1, 2 ** 32 - 1),
    fg: rect(j.fg), monitor: rect(j.monitor), max: j.max === true,
    cpu: num(j.cpu, 0, 100), mem: num(j.mem, 0, 4096), gpu: num(j.gpu, 0, 100), gpuTemp: num(j.gpuTemp, 0, 150),
  };
}
