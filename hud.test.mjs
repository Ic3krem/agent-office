import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './world-vm.mjs';

const H = loadWorld({ extra: ['hud.js'] }).Hud;
const J = v => JSON.parse(JSON.stringify(v));

test('tasksOf: doing goals and working agents are "On it"; to do and blocked are "Waiting"; the rest hidden', () => {
  const snap = {
    goals: [{ id: 'g1', text: 'Ship it', status: 'doing' }, { id: 'g2', text: 'Plan', status: 'todo' }, { id: 'g3', text: 'Ask', status: 'blocked', note: 'needs you' }, { id: 'g4', text: 'Old', status: 'done' }, { id: 'g5', text: 'Idea', status: 'proposed' }, { id: 'g6', text: 'No', status: 'dismissed' }],
    agents: [{ id: 'a', name: 'Tiro', isManager: true, status: 'working', task: 'Reading the board' }, { id: 'b', name: 'Mika', status: 'working', task: 'Coding…', profile: { key: 'dev' } }, { id: 'c', name: 'Ola', status: 'idle', task: '' }, { id: 'd', name: 'Ben', status: 'blocked', task: 'Bash' }],
  };
  assert.deepEqual(J(H.tasksOf(snap)), {
    onIt: [{ text: 'Ship it', who: 'goal' }, { text: 'Reading the board', who: 'Tiro' }, { text: 'Coding…', who: 'Mika' }],
    waiting: [{ text: 'Plan', who: 'to do' }, { text: 'Ask', who: 'needs you' }, { text: 'Bash', who: 'Ben · waiting for approval' }],
  });
  assert.deepEqual(J(H.tasksOf(null)), { onIt: [], waiting: [] });
});

test('bubbleText: plain, one line, at most 140 characters', () => {
  assert.equal(H.bubbleText('hi\nthere'), 'hi there');
  const long = H.bubbleText('x'.repeat(200));
  assert.equal(long.length, 140); assert.ok(long.endsWith('…'));
});
