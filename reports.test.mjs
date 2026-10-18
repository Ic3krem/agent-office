import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reportStore, dailyMarkdown, mdToHtml, reportXlsx } from './reports.mjs';
import { agentVault, seedMemory } from './vault.mjs';

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('a structured report is saved as readable Markdown plus data, listed with its outcome, and only read by its own names', async () => {
  const r = reportStore(tmp('ao-r-'));
  const file = r.save({ goalId: 'gabc123', title: 'QA: develop branch!', outcome: 'partial', summary: 'Builds pass; one test suite could not run.',
    findings: [{ item: 'API tests', status: 'ok', detail: 'pytest passes' }, { item: 'Laravel | Pest', status: 'issue', detail: 'no PHP locally' }], nextSteps: ['Run Pest in Docker'] });
  assert.match(file, /^\d{4}-\d\d-\d\d\/gabc123-qa-develop-branch\.md$/);
  const md = r.read(file);
  assert.match(md, /## Summary\n\nBuilds pass/);
  assert.match(md, /\| ⚠️ Issue \| Laravel \\\| Pest \| no PHP locally \|/);
  assert.match(md, /1\. Run Pest in Docker/);
  assert.deepEqual(r.list().map(x => [x.title, x.outcome, x.goalId]), [['QA: develop branch!', 'partial', 'gabc123']]);
  assert.throws(() => r.read('../../.ssh/id_rsa'));
  const html = mdToHtml(md + '\n<script>alert(1)</script>');
  assert.match(html, /<td>Laravel \| Pest<\/td>/);
  assert.ok(!html.includes('<script>'));
  assert.ok((await reportXlsx(r.meta(file))).byteLength > 1000);
});

test('the daily report groups goals and links their reports', () => {
  const md = dailyMarkdown({ day: '2026-10-19', goals: [{ id: 'g000001', text: 'Fix retries', status: 'done', note: 'Shipped' }, { id: 'g000002', text: 'Docker tests', status: 'blocked', note: 'Approve docker run' }],
    reports: [{ goalId: 'g000001', file: '2026-10-19/g000001-fix.md', title: 'Retries fixed' }], usage: { tokens: 12e6, session: 40, weekly: 80 } });
  assert.match(md, /\*\*1 done · 1 need you · 0 open\*\*/);
  assert.match(md, /## Needs you[\s\S]*Docker tests \| Approve docker run/);
  assert.match(md, /\[\[Agent Office\/Reports\/2026-10-19\/g000001-fix\\\|Retries fixed\]\]/);
});

test('vault memory: write, search, link, graph; seeding copies Claude memory notes once', () => {
  const v = agentVault(tmp('ao-v-'));
  v.write('n8n-ops', { description: 'How to edit n8n workflows', body: 'Use the CLI. See [[droplet]].' });
  v.write('droplet', { description: 'The Cicerojarv droplet', body: 'Ubuntu box running n8n.' });
  assert.deepEqual(v.search('edit n8n').map(n => n.name), ['n8n-ops', 'droplet']);
  v.link('droplet', 'n8n-ops');
  assert.deepEqual(v.graph().edges, [{ from: 'droplet', to: 'n8n-ops' }, { from: 'n8n-ops', to: 'droplet' }].sort((a, b) => a.from.localeCompare(b.from)));
  assert.throws(() => v.write('../evil', { body: 'x' }));
  const mem = tmp('ao-m-');
  fs.writeFileSync(path.join(mem, 'infra_x.md'), '---\nname: infra-x\ndescription: X box\nmetadata:\n  type: reference\n---\n\nBody [[droplet]]');
  fs.writeFileSync(path.join(mem, 'MEMORY.md'), '- index');
  assert.equal(seedMemory(v, mem), 1);
  assert.equal(seedMemory(v, mem), 0);
  assert.match(v.read('infra-x'), /type: reference/);
});
