import fs from 'node:fs';
import vm from 'node:vm';

// Canonical page order; a script that does not exist yet is skipped.
const ORDER = ['role-catalog.js', 'world-path.js', 'office-motion.js', 'office-furniture.js', 'world-model.js', 'world-edit.js'];

// Load the classic browser scripts into one vm context. ctxFactory() supplies the 2D context
// returned by any document.createElement('canvas').getContext('2d'). `extra` names more public scripts to run after them.
export function loadWorld({ ctxFactory = () => ({}), globals = {}, extra = [] } = {}) {
  const canvas = () => ({ width: 0, height: 0, getContext: () => ctxFactory() });
  const ctx = { document: { createElement: canvas }, ...globals };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of [...ORDER, ...extra]) {
    const url = new URL('./public/' + f, import.meta.url);
    if (fs.existsSync(url)) vm.runInContext(fs.readFileSync(url, 'utf8'), ctx, { filename: f });
  }
  return ctx;
}
