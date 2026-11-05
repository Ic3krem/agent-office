// Names that must never appear in the public repository (the maintainer's employer, clients, machines). The list itself is kept
// OUTSIDE the repository so publishing it cannot leak it: one regular expression per line in the file named by
// AGENT_OFFICE_PRIVATE_TERMS, or ~/.agent-office-private-terms.txt. Without that file the checks that use it are skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function privateTerms(env = process.env) {
  const file = env.AGENT_OFFICE_PRIVATE_TERMS || path.join(os.homedir(), '.agent-office-private-terms.txt');
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')); } catch { return null; }
  return lines.length ? new RegExp(lines.join('|'), 'i') : null;
}
