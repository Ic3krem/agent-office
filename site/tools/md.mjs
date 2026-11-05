import { esc } from './layout.mjs';

// ---------- markdown subset ----------
export const slugify = t => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[`*_]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

function inline(src, ctx) {
  const codes = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, href) => ctx.picture(href, alt));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text0, href) => {
    let text = text0;
    const r = ctx.link(href.replace(/&amp;/g, '&'));
    const nm = text.match(/^(?:docs\/)?([\w-]+)\.md$/);
    if (nm && ctx.titleOf && ctx.titleOf(nm[1])) text = ctx.titleOf(nm[1]);
    return r ? `<a href="${esc(r)}"${/^https:/.test(r) ? ' rel="noopener noreferrer"' : ''}>${text}</a>` : text;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}

export function renderMd(md, ctx, { shift = 0 } = {}) {
  const lines = md.split('\n');
  const out = [], ids = [];
  let i = 0;
  const flushPara = para => { if (para.length) out.push(`<p>${inline(para.join(' '), ctx)}</p>`); };
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^```(\w*)/))) {
      const buf = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(`<pre tabindex="0"><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) {
      const lvl = Math.min(6, Math.max(2, m[1].length + shift));
      const id = slugify(m[2]); ids.push({ id, text: m[2].replace(/[`*]/g, ''), lvl });
      out.push(`<h${lvl} id="${id}">${inline(m[2], ctx)}</h${lvl}>`); i++; continue;
    }
    if (/^---+\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (l.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMd(buf.join('\n'), ctx, { shift }).html}</blockquote>`); continue;
    }
    if (l.startsWith('|') && /^\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      const cells = r => r.replace(/^\||\|\s*$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
      const head = cells(l); i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]));
      out.push(`<div class="table-wrap" role="region" aria-label="${esc(((head[0] || 'Table') + ' table').replace(/`/g, '').replace(/kiro/gi, 'settings'))}" tabindex="0"><table><thead><tr>${head.map(c => `<th scope="col">${inline(c, ctx)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c, ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^(\s*)([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items = [];
      while (i < lines.length && (/^([-*]|\d+\.)\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (/^([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i].replace(/^([-*]|\d+\.)\s+/, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
        // a blank line followed by a code fence belongs to the list item in the source; keep it simple and end the list
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(t => `<li>${inline(t, ctx)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|>|\||---+\s*$|([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) { para.push(lines[i++]); }
    flushPara(para);
  }
  return { html: out.join('\n'), ids };
}

