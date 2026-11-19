// The optional Claude API key (Settings -> Claude, "Use: API key"). Desktop only: entered in a native window, kept
// encrypted by the OS (Electron safeStorage, passed in as enc/dec), handed to the server child as ANTHROPIC_API_KEY.
// Never logged, never in kiro.json; the page sees keyHint() only.
import fs from 'node:fs';

export const keyShape = s => typeof s === 'string' && /^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(s);
export const keyHint = s => (typeof s === 'string' && s.length >= 4 ? '…' + s.slice(-4) : '');
// shape: the validator for what is stored (the calendar link uses these helpers with its own); the error never echoes the value.
export function saveKey(file, key, enc, shape = keyShape) {
  if (!shape(key)) throw new Error(shape === keyShape ? 'That does not look like a Claude API key (it starts with sk-ant-).' : 'That value is not valid.');
  fs.writeFileSync(file, enc(key), { mode: 0o600 });
}
export function loadKey(file, dec, shape = keyShape) {
  try { const k = dec(fs.readFileSync(file)); return shape(k) ? k : ''; } catch { return ''; }
}
export const removeKey = file => fs.rmSync(file, { force: true });
