// Refuse to run with Chromium or Node debugging switches: a remote-debugging port or an inspector lets any local process drive the
// app's windows (and with them the signed-in session), so the app exits with a message instead.
const UNSAFE = /^--?(remote-debugging-(port|pipe|address)|remote-allow-origins|inspect(-brk|-port|-wait|-publish-uid)?|debug(-brk|-port)?|js-flags=.*(inspect|debug)|enable-features=.*remotedebugging|auto-open-devtools-for-tabs)\b/i;

export const unsafeSwitches = (argv = process.argv) => argv.slice(1).filter(a => UNSAFE.test(String(a)));

export const unsafeMessage = list => `TiroAgents will not start with debugging switches (${list.join(' ')}). They would let any program on this PC control its windows. Remove them and start the app again.`;

// Environment variables that turn on the same capability for Node/Electron.
export const unsafeEnv = (env = process.env) => ['NODE_OPTIONS', 'ELECTRON_EXTRA_LAUNCH_ARGS'].filter(k => /inspect|remote-debugging|--debug/i.test(String(env[k] || '')));
