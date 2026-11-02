import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classify, digest, inHours, nextCheckAfter, renderTiroNote, run, mailboxOf } from './scheduler-job.mjs';
import { readScheduler } from './scheduler.mjs';

const MAILBOX = 'inbox@example.com'; process.env.AGENT_OFFICE_MAILBOX = MAILBOX;
const WED = new Date(2026, 10, 4, 10, 0, 0);          // Wed 10:00 local
const feedOf = (msgs, over = {}) => ({ mailbox: MAILBOX, generatedAt: new Date(WED.getTime() - 5 * 60e3).toISOString(), messages: msgs, ...over });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sj-'));
const put = (dir, f) => { const p = path.join(dir, 'inbox-feed.json'); fs.writeFileSync(p, JSON.stringify(f)); return p; };

test('classify: task, need, info, noise', () => {
  assert.equal(classify('Action required: renew SSL certificate'), 'task');
  assert.equal(classify('Can you give Maria access to the shared drive?'), 'need');
  assert.equal(classify('Printer on 3rd floor not working'), 'need');
  assert.equal(classify('Lunch menu update'), 'info');
  assert.equal(classify('Example report for Example'), null);
  assert.equal(classify('Weekly digest newsletter'), null);
  assert.equal(classify(''), null);
  assert.equal(classify('Backup job', ['Task']), 'task');
});

test('business hours and next check', () => {
  assert.ok(inHours(WED));
  assert.ok(!inHours(new Date(2026, 10, 4, 20, 0)));
  assert.ok(!inHours(new Date(2026, 10, 7, 10, 0)), 'Saturday');
  assert.equal(nextCheckAfter(WED).getTime() - WED.getTime(), 30 * 60e3);
  const n = nextCheckAfter(new Date(2026, 10, 6, 18, 50));   // Fri evening -> Mon 07:00
  assert.equal([n.getDay(), n.getHours(), n.getMinutes()].join(':'), '1:7:0');
});

test('digest: unread only, redacted, capped, wrong mailbox and stale feed refused', () => {
  const d = digest(feedOf([
    { subject: 'Need access to ERP', received: WED.toISOString(), isRead: false },
    { subject: 'Already read: need help', isRead: true },
    { subject: 'Reset password=hunter2 please', received: WED.toISOString() },
    { subject: 'Example report', received: WED.toISOString() },
  ]), WED.getTime(), MAILBOX);
  assert.equal(d.ok, true);
  assert.equal(d.items.length, 2);
  assert.ok(d.items.every(i => !/hunter2/.test(i.title)));
  assert.equal(digest(feedOf([], { mailbox: 'other@example.com' }), WED.getTime(), MAILBOX).ok, false);
  assert.equal(digest(feedOf([], { generatedAt: new Date(WED.getTime() - 3 * 3600e3).toISOString() }), WED.getTime(), MAILBOX).ok, false);
  assert.equal(digest(feedOf([]), WED.getTime(), '').ok, false, 'no mailbox configured');
  assert.equal(digest(feedOf(Array.from({ length: 50 }, (_, i) => ({ subject: 'Need thing ' + i }))), WED.getTime(), MAILBOX).items.length, 20);
  assert.equal(digest(null).ok, false);
});

test('run: dry-run writes nothing; real run writes state, Tiro note, dedupes', () => {
  const home = tmp(), feed = put(home, feedOf([{ subject: 'Need a new laptop for Sam', received: WED.toISOString() }, { subject: 'Reminder: license due Friday', received: WED.toISOString() }]));
  const dry = run({ home, feed, dry: true, now: WED });
  assert.equal(dry.state.itemsFound, 2);
  assert.ok(!fs.existsSync(path.join(home, 'scheduler.json')));
  assert.ok(!fs.existsSync(path.join(home, 'agents')));
  const r = run({ home, feed, now: WED });
  assert.equal(r.fresh.length, 2);
  const s = readScheduler(path.join(home, 'scheduler.json'), WED.getTime());
  assert.equal(s.present, true); assert.equal(s.itemsFound, 2); assert.equal(s.items.length, 2); assert.equal(s.stale, false);
  const note = fs.readFileSync(path.join(home, 'agents', 'tiro', 'memory', 'scheduler-inbox.md'), 'utf8');
  assert.match(note, /\[need\] Need a new laptop for Sam/);
  const r2 = run({ home, feed, now: new Date(WED.getTime() + 30 * 60e3) });
  assert.equal(r2.fresh.length, 0, 'same mails are not re-announced');
  const note2 = fs.readFileSync(path.join(home, 'agents', 'tiro', 'memory', 'scheduler-inbox.md'), 'utf8');
  assert.ok(note2.indexOf('(nothing new)') < note2.indexOf('Need a new laptop'), 'newest first');
});

test('run: missing feed is reported honestly; outside hours skipped unless forced', () => {
  const home = tmp();
  const r = run({ home, now: WED });
  assert.equal(r.state.itemsFound, 0); assert.match(r.state.note, /No mail feed/);
  const off = new Date(2026, 10, 7, 10, 0);
  assert.ok(run({ home: tmp(), now: off }).skipped);
  assert.ok(!run({ home: tmp(), now: off, force: true, dry: true }).skipped);
});

test('Tiro note is capped and holds no bodies', () => {
  let t = '';
  for (let i = 0; i < 60; i++) t = renderTiroNote(t, new Date(2026, 10, 4, 10, i).toISOString(), [{ kind: 'need', title: 'x'.repeat(140) }], 'note');
  assert.ok(Buffer.byteLength(t) <= 8000);
  assert.ok((t.match(/^## /gm) || []).length <= 30);
  assert.ok(/^# Scheduler inbox/.test(t));
});

test('job source has no network, mail-write or auth code', () => {
  const src = fs.readFileSync(new URL('./scheduler-job.mjs', import.meta.url), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  for (const bad of [/\bfetch\(/, /node:https?/, /node:net/, /child_process/, /Connect-MgGraph/, /sendMail|\/send\b|\/reply|\/move|DELETE|PATCH/]) assert.doesNotMatch(src, bad);
});
