// Scenery bubble (town step 5): a short canned line over the player on walking into a spot, the karinderya lot or up to an
// animal. Pure state machine, no DOM: town.html shows what step() returns. Classic script: root.TownScenery.
// One bubble at a time; an area speaks again only after the player has been outside its exit rect (the area grown by EXIT,
// so jitter on the edge never re-triggers) for COOLDOWN_MS. No tokens: every line is in public/town/scenery-lines.json.
(function (root) {
  'use strict';
  const SHOW_MS = 6000, COOLDOWN_MS = 60000, ANIMAL_R = 40, ANIMAL_COOLDOWN_MS = 30000, GROW = 20, EXIT = 30;
  const grow = (r, d) => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
  const inR = (p, r) => r.length === 3 ? Math.hypot(p.x - r[0], p.y - r[1]) < r[2] : p.x >= r[0] && p.x < r[2] && p.y >= r[1] && p.y < r[3]; // rect, or circle [x, y, r]
  const FOUNTAIN_R = 60;
  const list = v => Array.isArray(v) ? v.filter(s => typeof s === 'string') : [];

  // lines: {spots: {<id>: {day, night}}, kain: {day, night}, fountain: {day, night}, animals: {<kind>: [..]}}; map: the town.
  function create(lines, map) {
    const areas = [];
    const add = (id, rect, set) => { const day = list(set && set.day), night = list(set && set.night); if (rect && day.length) areas.push({ id, rect, exit: rect.length === 3 ? [rect[0], rect[1], rect[2] + EXIT] : grow(rect, EXIT), day, night: night.length ? night : day, inside: false, leftAt: null, n: 0 }); };
    for (const s of map.spots || []) add(s.id, s.bubble || grow(s.rect, GROW), lines.spots && lines.spots[s.id]);
    const kain = (map.lots || []).find(l => l.kind === 'kain');
    if (kain) add('kain', kain.rect, lines.kain);
    (map.decor || []).filter(it => it.type === 'fountain').forEach((f, i) => add('fountain' + i, [f.x, f.y, FOUNTAIN_R], lines.fountain)); // the plaza fountain
    const pets = new Map(); // animal id -> {at: last shown, n}
    let until = -Infinity;
    return {
      // player {x, y}; night: Graphics.nightOf (>= 0.5 picks night lines); animals [{id, kind, x, y}] as drawn.
      // -> {text, until} when a bubble starts this step, else null.
      step(p, now, night, animals) {
        let out = null;
        for (const a of areas) {
          if (a.inside) { if (!inR(p, a.exit)) { a.inside = false; a.leftAt = now; } continue; }
          if (!inR(p, a.rect)) continue;
          a.inside = true; // an entry: it speaks unless a bubble is up or it is cooling down
          if (out || now < until || (a.leftAt != null && now - a.leftAt < COOLDOWN_MS)) continue;
          const set = night >= 0.5 ? a.night : a.day;
          out = { text: set[a.n++ % set.length], until: now + SHOW_MS };
        }
        if (!out && now >= until) for (const an of animals || []) {
          const said = list(lines.animals && lines.animals[an.kind]), e = pets.get(an.id) || { at: -Infinity, n: 0 };
          if (!said.length || Math.hypot(an.x - p.x, an.y - p.y) > ANIMAL_R || now - e.at < ANIMAL_COOLDOWN_MS) continue;
          out = { text: said[e.n++ % said.length], until: now + SHOW_MS }; e.at = now; pets.set(an.id, e);
          break;
        }
        if (out) until = out.until;
        return out;
      },
    };
  }

  root.TownScenery = { create, SHOW_MS, COOLDOWN_MS, ANIMAL_R, ANIMAL_COOLDOWN_MS };
})(globalThis);
