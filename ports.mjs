// Which port the office server listens on, and how the desktop app and the terminals' bridge find it.
// 4777 is preferred. When an unrelated program holds it, the server takes the next free port (up to 4796) and writes the
// port it bound into bridge.json, which the desktop app and the bridge read. AGENT_OFFICE_PORT pins one port (dev copies, tests).
import fs from 'node:fs';

export const DEFAULT_PORT = 4777, PORT_SPAN = 20;
export const MARKER = 'x-agent-office'; // response header on every reply, so a probe can tell another Agent Office from an unrelated program

const valid = p => Number.isInteger(p) && p > 0 && p < 65536;
export const candidatePorts = (env = process.env) => {
  const pinned = Number(env.AGENT_OFFICE_PORT);
  return valid(pinned) ? [pinned] : Array.from({ length: PORT_SPAN }, (_, i) => DEFAULT_PORT + i);
};
export const publishedPort = file => { try { const p = Number(JSON.parse(fs.readFileSync(file, 'utf8')).port); return valid(p) ? p : 0; } catch { return 0; } };
// No credential is sent: a program squatting on the port learns nothing.
export const isAgentOffice = (port, timeoutMs = 1500) => fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) }).then(r => r.headers.has(MARKER), () => false);

// Listens on the first free candidate. A port held by another Agent Office is not skipped: two offices would split the terminals,
// so that ends with an 'already running' error instead.
export function listenFirstFree(server, ports, { host = '127.0.0.1', probe = isAgentOffice } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = i => {
      const onError = async e => {
        server.removeListener('listening', onListening);
        if (e.code !== 'EADDRINUSE') return reject(e);
        if (await probe(ports[i])) return reject(Object.assign(new Error(`Agent Office is already running on port ${ports[i]}`), { code: 'AO_RUNNING', port: ports[i] }));
        if (i + 1 >= ports.length) return reject(Object.assign(new Error(`No free port in ${ports[0]}-${ports.at(-1)}`), { code: 'AO_NO_PORT' }));
        attempt(i + 1);
      };
      const onListening = () => { server.removeListener('error', onError); resolve(server.address().port); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(ports[i], host);
    };
    attempt(0);
  });
}
