// Grid + A* path finder for the office world. Standalone classic script: root.WorldPath.
(function (root) {
  'use strict';
  const { SQRT2: SQ2, abs, max, min, floor, ceil, hypot } = Math;

  function buildGrid({ w, h, cell, blocks = [], costs = [] }) {
    const cols = ceil(w / cell), rows = ceil(h / cell), n = cols * rows;
    const blocked = new Uint8Array(n), cost = new Float32Array(n).fill(1);
    const touched = new Uint8Array(n); // cells with an explicit zone cost
    // a block shrunk by 1 unit must overlap the cell interior with positive area
    for (const [x0, y0, x1, y1] of blocks) {
      for (let r = max(0, floor((y0 + 1) / cell)); r < rows && r * cell < y1 - 1; r++)
        for (let c = max(0, floor((x0 + 1) / cell)); c < cols && c * cell < x1 - 1; c++)
          if ((c + 1) * cell > x0 + 1 && (r + 1) * cell > y0 + 1) blocked[r * cols + c] = 1;
    }
    for (const { rect: [x0, y0, x1, y1], cost: k } of costs) {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const cx = (c + 0.5) * cell, cy = (r + 0.5) * cell;
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) {
          const i = r * cols + c;
          if (!touched[i] || k < cost[i]) { cost[i] = k; touched[i] = 1; }
        }
      }
    }
    // clearance: free cells beside a wall cost more
    const near = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (blocked[i]) continue;
      let hit = false;
      for (let dr = -1; dr <= 1 && !hit; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && blocked[rr * cols + cc]) { hit = true; break; }
      }
      if (hit) near.push(i);
    }
    for (const i of near) cost[i] *= 1.6;
    let minCost = Infinity;
    for (let i = 0; i < n; i++) if (!blocked[i] && cost[i] < minCost) minCost = cost[i];
    return { cols, rows, cell, blocked, cost, minCost };
  }

  function cellOf(g, p) {
    const c = min(g.cols - 1, max(0, floor(p.x / g.cell)));
    const r = min(g.rows - 1, max(0, floor(p.y / g.cell)));
    return r * g.cols + c;
  }

  // Walks the segment: mean cell cost along it, or -1 on a blocked cell or one costing more than maxCost.
  function walk(g, a, b, maxCost) {
    const d = hypot(b.x - a.x, b.y - a.y), steps = max(1, ceil(d / (g.cell / 4)));
    let sum = 0;
    for (let s = 0; s <= steps; s++) {
      const i = cellOf(g, { x: a.x + (b.x - a.x) * s / steps, y: a.y + (b.y - a.y) * s / steps });
      if (g.blocked[i] || g.cost[i] > maxCost) return -1;
      sum += g.cost[i];
    }
    return sum / (steps + 1);
  }
  const lineClear = (g, a, b) => walk(g, a, b, Infinity) >= 0;

  // A blocked endpoint cell is left/entered through the nearest ring of free cells, cheapest first.
  function freeCellFor(g, start) {
    if (!g.blocked[start]) return start;
    const seen = new Set([start]);
    let ring = [start];
    while (ring.length) {
      let best = -1; const next = [];
      for (const i of ring) {
        const r = (i / g.cols) | 0, c = i % g.cols;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc, j = rr * g.cols + cc;
          if (rr < 0 || rr >= g.rows || cc < 0 || cc >= g.cols || seen.has(j)) continue;
          seen.add(j);
          if (!g.blocked[j]) { if (best < 0 || g.cost[j] < g.cost[best]) best = j; }
          else next.push(j);
        }
      }
      if (best >= 0) return best;
      ring = next;
    }
    return -1;
  }

  function findPath(g, from, to) {
    const s = freeCellFor(g, cellOf(g, from)), t = freeCellFor(g, cellOf(g, to));
    if (s < 0 || t < 0) return [];
    const { cols, rows, cell, cost, minCost } = g, n = cols * rows;
    const tc = t % cols, tr = (t / cols) | 0;
    const heur = (i) => {
      const dx = abs(i % cols - tc), dy = abs(((i / cols) | 0) - tr);
      return (max(dx, dy) + (SQ2 - 1) * min(dx, dy)) * minCost;
    };
    const gs = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    // binary min-heap (parallel f / index arrays), stale entries skipped on pop
    const hF = [], hI = [];
    const push = (f, i) => {
      let k = hF.length; hF.push(f); hI.push(i);
      while (k > 0) { const p = (k - 1) >> 1; if (hF[p] <= f) break; hF[k] = hF[p]; hI[k] = hI[p]; k = p; }
      hF[k] = f; hI[k] = i;
    };
    const pop = () => {
      const top = hI[0], f = hF.pop(), i = hI.pop(), m = hF.length;
      if (m) {
        let k = 0;
        for (;;) {
          let c = 2 * k + 1; if (c >= m) break;
          if (c + 1 < m && hF[c + 1] < hF[c]) c++;
          if (hF[c] >= f) break;
          hF[k] = hF[c]; hI[k] = hI[c]; k = c;
        }
        hF[k] = f; hI[k] = i;
      }
      return top;
    };
    gs[s] = 0; push(heur(s), s);
    while (hI.length) {
      const i = pop();
      if (done[i]) continue;
      done[i] = 1;
      if (i === t) break;
      const r = (i / cols) | 0, c = i % cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        const j = rr * cols + cc;
        if (g.blocked[j] || done[j]) continue;
        if (dr && dc && (g.blocked[r * cols + cc] || g.blocked[rr * cols + c])) continue; // no corner cutting
        const ng = gs[i] + (dr && dc ? SQ2 : 1) * (cost[i] + cost[j]) / 2;
        if (ng < gs[j]) { gs[j] = ng; prev[j] = i; push(ng + heur(j), j); }
      }
    }
    if (!done[t]) return [];
    const mid = [];
    for (let i = t; i >= 0; i = prev[i]) mid.push({ x: (i % cols + 0.5) * cell, y: (((i / cols) | 0) + 0.5) * cell });
    mid.reverse();
    const pts = [{ x: from.x, y: from.y }, ...mid, { x: to.x, y: to.y }];
    // string-pull: a hop must stay on cells no costlier than its endpoints' and not cost more than the route it replaces
    const pre = [0];
    for (let k = 1; k < pts.length; k++) {
      const w = walk(g, pts[k - 1], pts[k], Infinity);
      pre.push(pre[k - 1] + hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y) * (w < 0 ? 1 : w));
    }
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1;) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) {
        const mc = max(g.cost[cellOf(g, pts[i])], g.cost[cellOf(g, pts[j])]);
        const w = walk(g, pts[i], pts[j], mc);
        if (w >= 0 && hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y) * w <= (pre[j] - pre[i]) * 1.02) break;
      }
      out.push(pts[j]); i = j;
    }
    return out;
  }

  root.WorldPath = { buildGrid, findPath, cellOf, lineClear };
})(globalThis);
