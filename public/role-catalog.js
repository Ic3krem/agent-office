// The roles a department desk can hold: display data shared by the page and the server (company.mjs loads it through vm).
// Server-only fields (tools, effort, brief) live in company.mjs. Standalone classic script: root.RoleCatalog.
(function (root) {
  'use strict';
  // props = the desk-prop painter style for this role.
  const ROLES = [
    { key: 'pixel', name: 'Pixel', role: 'Frontend engineer', kind: 'coder', model: 'sonnet', color: '#e0679a', accent: '#ffb3d1', props: 'pixel' },
    { key: 'forge', name: 'Forge', role: 'Backend engineer', kind: 'coder', model: 'sonnet', color: '#e08a3a', accent: '#ffc78a', props: 'forge' },
    { key: 'warden', name: 'Warden', role: 'Security reviewer', kind: 'coder', model: 'opus', color: '#5b7fd1', accent: '#a9c1f5', props: 'warden' },
    { key: 'probe', name: 'Probe', role: 'QA and test engineer', kind: 'coder', model: 'sonnet', color: '#4fb286', accent: '#a5e6c6', props: 'probe' },
    { key: 'atlas', name: 'Atlas', role: 'Deep researcher', kind: 'research', model: 'opus', color: '#8a63c9', accent: '#c9b0f0', props: 'atlas' },
    { key: 'cabalan', name: 'Cabalan', role: 'Researcher', kind: 'research', model: 'haiku', color: '#3fb0b8', accent: '#9de4e8', props: 'cabalan' },
    { key: 'tally', name: 'Tally', role: 'Task checker and organizer', kind: 'ops', model: 'haiku', color: '#d6b13a', accent: '#f5e08f', props: 'tally' },
    { key: 'scribe', name: 'Scribe', role: 'SOP and document writer', kind: 'writer', model: 'sonnet', color: '#b8785a', accent: '#e8b99f', props: 'scribe' },
    { key: 'it', name: 'Byte', role: 'IT support and sysadmin', kind: 'ops', model: 'sonnet', color: '#2f8fd8', accent: '#9fd0f7', props: 'it' },
    { key: 'accounting', name: 'Ledger', role: 'Accountant', kind: 'ops', model: 'sonnet', color: '#5f9e3a', accent: '#b5dc96', props: 'accounting' },
    { key: 'marketing', name: 'Spark', role: 'Marketing writer', kind: 'writer', model: 'sonnet', color: '#e0503f', accent: '#ffa99c', props: 'marketing' },
    { key: 'auditor', name: 'Vera', role: 'Auditor and compliance reviewer', kind: 'research', model: 'opus', color: '#4a4f8c', accent: '#a6aae0', props: 'auditor' },
    { key: 'notetaker', name: 'Memo', role: 'Meeting notes and minutes', kind: 'writer', model: 'haiku', color: '#7f8c8d', accent: '#c8d0d1', props: 'notetaker' },
  ];
  // Saved layouts from before roles existed: a desk without a role param holds its built-in role.
  const BUILTIN_DESKS = { 'desk-1': 'pixel', 'desk-2': 'forge', 'desk-3': 'warden', 'desk-4': 'probe', 'desk-5': 'atlas', 'desk-6': 'cabalan', 'desk-7': 'tally', 'desk-8': 'scribe' };
  // Wardrobe presets (phase 5): a costume is a set of indices into these lists, never free colours or uploads.
  const WARDROBE = {
    hair: ['#d39a52', '#3b2418', '#1f1a1a', '#141010', '#c9c3b8', '#6b3a1f', '#a8432a', '#2a2a3a'],
    skin: ['#f0c69c', '#c98d62', '#e6b48c', '#8d5a3b', '#f2cfae', '#d9a57a', '#f3d0b0', '#b5774f'],
    styles: ['Short', 'Long', 'Spiky'],
    outfits: [
      { name: 'Role colours', shirt: null, pants: null }, { name: 'Office grey', shirt: '#6d7480', pants: '#2f3a4f' },
      { name: 'Barong', shirt: '#efe6cf', pants: '#2a2733' }, { name: 'Hoodie', shirt: '#3f5f8a', pants: '#3b3b3b' },
      { name: 'Hi-vis', shirt: '#e8d23a', pants: '#2f3a4f' }, { name: 'Chef whites', shirt: '#f3ede2', pants: '#3b3b3b' },
      { name: 'Sunset', shirt: '#e0674a', pants: '#47352f' }, { name: 'Forest', shirt: '#3e7d55', pants: '#2c4038' },
    ],
    props: ['none', 'headphones', 'hardhat', 'visor', 'goggles', 'glasses', 'scarf', 'clipboard', 'pen', 'tie', 'suit'],
    heights: ['short', 'average', 'tall'],
  };
  // Default accessory per agent (the look each role had before costumes existed).
  const ROLE_PROP = { pixel: 'headphones', forge: 'hardhat', warden: 'visor', probe: 'goggles', atlas: 'glasses', cabalan: 'scarf', tally: 'clipboard', scribe: 'pen', tiro: 'tie', ceo: 'suit' };
  const LOOK_KEYS = () => ['ceo', 'tiro', ...ROLES.map(r => r.key)];
  const idx = (v, n) => Number.isInteger(v) && v >= 0 && v < n ? v : undefined;
  // Only known fields with in-range values survive; anything else (strings, colours, extra keys) is dropped.
  function cleanCostume(c) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
    const out = { hair: idx(c.hair, WARDROBE.hair.length), skin: idx(c.skin, WARDROBE.skin.length), style: idx(c.style, WARDROBE.styles.length),
      outfit: idx(c.outfit, WARDROBE.outfits.length), prop: WARDROBE.props.includes(c.prop) ? c.prop : undefined,
      height: WARDROBE.heights.includes(c.height) ? c.height : undefined };
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return Object.keys(out).length ? out : null;
  }
  function cleanLooks(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
    for (const k of LOOK_KEYS()) { if (!Object.prototype.hasOwnProperty.call(obj, k)) continue; const c = cleanCostume(obj[k]); if (c) out[k] = c; }
    return out;
  }
  const api = { ROLES, BUILTIN_DESKS, WARDROBE, ROLE_PROP, LOOK_KEYS, cleanCostume, cleanLooks, get: key => ROLES.find(r => r.key === key) || null, keys: () => ROLES.map(r => r.key) };
  root.RoleCatalog = api;
})(globalThis);
