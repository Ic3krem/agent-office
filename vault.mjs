// The agents' long-term memory is an Obsidian vault: plain Markdown notes linked with [[name]].
// Everything here is file work only; no model calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The open vault from Obsidian's own config, else a vault folder of our own in Documents.
export function findVault(home = os.homedir()) {
  const cfgs = [
    path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'obsidian', 'obsidian.json'),
    path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json'),
    path.join(home, '.config', 'obsidian', 'obsidian.json'),
  ];
  for (const f of cfgs) {
    try {
      const vaults = Object.values(JSON.parse(fs.readFileSync(f, 'utf8')).vaults || {});
      const v = vaults.find(x => x.open) || vaults[0];
      if (v?.path && fs.existsSync(v.path)) return v.path;
    } catch {}
  }
  return path.join(home, 'Documents', 'Agent Office Vault');
}

const NAME = /^[a-z0-9][a-z0-9-]{1,59}$/;
const LINK = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;
const fm = text => { const m = text.match(/^---\n([\s\S]*?)\n---\n?/); return m ? { head: m[1], body: text.slice(m[0].length) } : { head: '', body: text }; };
const field = (head, k) => (head.match(new RegExp('^\\s*' + k + ':\\s*(.*)$', 'm')) || [])[1]?.replace(/^["']|["']$/g, '') || '';

export function agentVault(root) {
  const base = path.join(root, 'Agent Office');
  const dirs = { memory: path.join(base, 'Memory'), reports: path.join(base, 'Reports'), daily: path.join(base, 'Daily'), sops: path.join(base, 'SOPs') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const notePath = name => { if (!NAME.test(name)) throw new Error('Note names are lowercase-with-dashes, 2-60 characters'); return path.join(dirs.memory, name + '.md'); };
  const notes = () => fs.readdirSync(dirs.memory).filter(n => n.endsWith('.md')).map(n => {
    const name = n.slice(0, -3), text = fs.readFileSync(path.join(dirs.memory, n), 'utf8'), { head, body } = fm(text);
    return { name, description: field(head, 'description'), type: field(head, 'type'), updated: field(head, 'updated'), body, links: [...new Set([...body.matchAll(LINK)].map(m => m[1].trim()))] };
  });

  if (!fs.existsSync(path.join(base, 'Home.md'))) fs.writeFileSync(path.join(base, 'Home.md'),
    `# Agent Office\n\nLong-term memory for Kiro and the specialists. Edit freely; agents read it before they work.\n\n- **Memory/**: one fact per note, linked with [[note-name]]\n- **Reports/**: what each finished goal produced\n- **Daily/**: one summary per day (written automatically)\n- **SOPs/**: Kiro's brief and the specialists' instructions\n`);

  return {
    root, base, dirs,
    // Plain term matching: rank by how many query words a note contains, title and description first.
    search(query, limit = 8) {
      const terms = String(query).toLowerCase().split(/\W+/).filter(t => t.length > 2);
      if (!terms.length) return [];
      return notes().map(n => {
        const hay = (n.name + ' ' + n.description + '\n' + n.body).toLowerCase();
        const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 + ((n.name + n.description).toLowerCase().includes(t) ? 1 : 0) : 0), 0);
        const line = n.body.split('\n').find(l => terms.some(t => l.toLowerCase().includes(t))) || '';
        return { name: n.name, description: n.description, snippet: line.trim().slice(0, 200), score };
      }).filter(n => n.score).sort((a, b) => b.score - a.score).slice(0, limit);
    },
    read(name) { return fs.readFileSync(notePath(name), 'utf8'); },
    write(name, { description = '', type = 'note', body = '' }) {
      const file = notePath(name), today = new Date().toLocaleDateString('en-CA');
      fs.writeFileSync(file, `---\nname: ${name}\ndescription: ${String(description).replace(/\n/g, ' ').slice(0, 200)}\ntype: ${type}\nupdated: ${today}\nsource: agent-office\n---\n\n${String(body).trim()}\n`);
      return file;
    },
    remove(name) { fs.rmSync(notePath(name)); },
    link(from, to) {
      notePath(to);
      const file = notePath(from), text = fs.readFileSync(file, 'utf8');
      if (text.includes(`[[${to}]]`)) return;
      fs.writeFileSync(file, text.replace(/\n*$/, `\n\nRelated: [[${to}]]\n`));
    },
    graph() {
      const all = notes(), names = new Set(all.map(n => n.name));
      return {
        nodes: all.map(n => ({ id: n.name, description: n.description, type: n.type, updated: n.updated })),
        edges: all.flatMap(n => n.links.filter(l => names.has(l) && l !== n.name).map(l => ({ from: n.name, to: l }))),
      };
    },
    sop(name, fallback) {
      const f = path.join(dirs.sops, name + '.md');
      if (!fs.existsSync(f)) fs.writeFileSync(f, fallback.trim() + '\n');
      return fs.readFileSync(f, 'utf8');
    },
    sops: () => fs.readdirSync(dirs.sops).filter(n => n.endsWith('.md')).map(n => ({ name: n.slice(0, -3), text: fs.readFileSync(path.join(dirs.sops, n), 'utf8') })),
    saveSop(name, text) {
      if (!/^[a-z0-9-]{2,40}$/.test(name)) throw new Error('bad SOP name');
      const f = path.join(dirs.sops, name + '.md');
      if (!fs.existsSync(f)) throw new Error('No SOP called ' + name);
      fs.writeFileSync(f, String(text).trim() + '\n');
    },
    writeDaily(day, markdown) { fs.writeFileSync(path.join(dirs.daily, day + '.md'), markdown); },
  };
}

// Seed the memory folder from Claude Code's own memory notes (same [[name]] links), skipping ones already there.
export function seedMemory(v, claudeMemoryDir) {
  let n = 0;
  for (const f of fs.existsSync(claudeMemoryDir) ? fs.readdirSync(claudeMemoryDir) : []) {
    if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
    const text = fs.readFileSync(path.join(claudeMemoryDir, f), 'utf8'), { head, body } = fm(text);
    const name = (field(head, 'name') || f.slice(0, -3)).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    if (!NAME.test(name) || fs.existsSync(path.join(v.dirs.memory, name + '.md'))) continue;
    v.write(name, { description: field(head, 'description'), type: field(head, 'type') || 'note', body });
    n++;
  }
  return n;
}
