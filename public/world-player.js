// CEO avatar movement: grid-collided keyboard/joystick walking plus click-to-walk paths. Standalone classic script: root.WorldPlayer.
(function (root) {
  'use strict';
  const SPEED = 170, REACH = 45, EDGE = 5;
  const create = (x, y) => ({ x, y, face: 's', moving: false, path: [], pi: 0 });
  const blockedAt = (g, x, y) => !!g.blocked[root.WorldPath.cellOf(g, { x, y })];
  const clampTo = (g, v, n) => Math.min(n * g.cell - EDGE, Math.max(EDGE, v));

  function step(p, dt, input, grid) {
    const dx = (input && input.dx) || 0, dy = (input && input.dy) || 0;
    const ox = p.x, oy = p.y;
    if (dx || dy) {
      p.path = []; p.pi = 0;
      // screen right = (+x,-y), screen down = (+x,+y)
      let gx = dx + dy, gy = dy - dx;
      const m = Math.hypot(gx, gy) || 1, d = SPEED * dt;
      gx = gx / m * d; gy = gy / m * d;
      const nx = clampTo(grid, p.x + gx, grid.cols), ny = clampTo(grid, p.y + gy, grid.rows);
      if (!blockedAt(grid, nx, p.y)) p.x = nx;
      if (!blockedAt(grid, p.x, ny)) p.y = ny;
    } else if (p.pi < p.path.length) {
      let left = SPEED * dt;
      while (left > 0 && p.pi < p.path.length) {
        const t = p.path[p.pi], dd = Math.hypot(t.x - p.x, t.y - p.y);
        if (dd <= left) { p.x = t.x; p.y = t.y; left -= dd; p.pi++; }
        else { p.x += (t.x - p.x) / dd * left; p.y += (t.y - p.y) / dd * left; left = 0; }
      }
      if (p.pi >= p.path.length) { p.path = []; p.pi = 0; }
    }
    const mx = p.x - ox, my = p.y - oy;
    p.moving = mx !== 0 || my !== 0;
    if (p.moving) p.face = root.OfficeMotion.faceOf(mx, my, p.face);
    return p;
  }

  function walkTo(p, target, pathTo) {
    const pts = pathTo({ x: p.x, y: p.y }, target);
    p.path = pts; p.pi = 1;
    const g = root.OfficeMotion.grid();
    // only the straight-line fallback (2 points) can cross blocked cells
    // ponytail: a real 2-point path ending in a blocked seat cell reads as unreachable; refine if click-to-seat needs it.
    return pts.length > 1 && (pts.length > 2 || !g || root.WorldPath.lineClear(g, pts[0], pts[1]));
  }

  function nearest(p, candidates) {
    let best = null;
    for (const c of candidates) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d <= REACH && (!best || d < best.d)) best = { kind: c.kind, id: c.id, d };
    }
    return best;
  }

  function unstick(p, grid) {
    const { cols, rows, cell, blocked } = grid, start = root.WorldPath.cellOf(grid, p);
    if (!blocked[start]) return p;
    const seen = new Uint8Array(cols * rows), q = [start];
    seen[start] = 1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], c = i % cols, r = (i - c) / cols;
      if (!blocked[i]) { p.x = c * cell + cell / 2; p.y = r * cell + cell / 2; p.path = []; p.pi = 0; return p; }
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cc = c + a, rr = r + b, j = rr * cols + cc;
        if (cc >= 0 && cc < cols && rr >= 0 && rr < rows && !seen[j]) { seen[j] = 1; q.push(j); }
      }
    }
    return p;
  }

  root.WorldPlayer = { create, step, walkTo, nearest, unstick, SPEED, REACH };
})(typeof globalThis !== 'undefined' ? globalThis : this);
