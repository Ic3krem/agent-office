import crypto from 'node:crypto';
import { loadWorld } from './world-vm.mjs';

const r2 = v => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const ser = v => (v && typeof v === 'object' ? v.tag || '[object]' : v);

export const hashLog = calls => crypto.createHash('sha1').update(JSON.stringify(calls)).digest('hex');

// A 2D context that records every call and property set into `calls`.
export function recorder(calls) {
  const store = {};
  const stub = (kind, args) => {
    const tag = kind + '(' + args.map(r2).join(',') + ')';
    return { tag, addColorStop: (...a) => calls.push(['addColorStop', tag, ...a.map(r2)]) };
  };
  return new Proxy({}, {
    get: (_, p) => {
      if (p in store) return store[p];
      if (p === 'measureText') return s => ({ width: String(s).length * 5 });
      if (p === 'createRadialGradient' || p === 'createLinearGradient') return (...a) => stub(p, a);
      if (p === 'createPattern') return (img, rep) => { calls.push(['createPattern', rep]); return { tag: 'pattern' }; };
      if (p === 'createImageData') return (...a) => ({ ...stub(p, a), data: new Uint8ClampedArray(4 * (a[0] * a[1] || 1)) });
      return (...a) => { calls.push([p, ...a.map(ser).map(r2)]); };
    },
    set: (_, p, v) => { store[p] = v; calls.push(['=', p, r2(ser(v))]); return true; },
  });
}

// Painters read the clock (wall clock/calendar); pin it so recordings are repeatable.
const FIXED = Date.UTC(2026, 0, 5, 10, 10, 0);
const FixedDate = class extends Date { constructor(...a) { super(...(a.length ? a : [FIXED])); } static now() { return FIXED; } };

// `extra` loads more page scripts; `prep(world)` runs before recording (e.g. applying a layout).
export function recordOffice({ extra = [], prep = () => {} } = {}) {
  const w = loadWorld({ ctxFactory: () => recorder([]), globals: { Date: FixedDate }, extra });
  prep(w);
  const M = w.OfficeMotion, F = w.OfficeFurniture;
  F.state.T = 0; F.state.night = 0;
  const items = F.items.map(it => {
    const calls = [];
    it.fn(recorder(calls));
    return { d: it.d, fp: it.fp, log: hashLog(calls) };
  });
  const objects = F.objects.map(o => ({ key: o.key, box: o.box }));
  return { items, objects, spots: JSON.parse(JSON.stringify(M.SPOTS)) };
}
