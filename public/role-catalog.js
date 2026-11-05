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
  const api = { ROLES, BUILTIN_DESKS, get: key => ROLES.find(r => r.key === key) || null, keys: () => ROLES.map(r => r.key) };
  root.RoleCatalog = api;
})(globalThis);
