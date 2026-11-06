import test from 'node:test';
import assert from 'node:assert/strict';
import { officeNav } from './desktop/office-nav.mjs';

test('officeNav: on the office page only the hash changes', () => {
  assert.deepEqual(officeNav('http://127.0.0.1:4777/', 'today'), { hash: 'today' });
  assert.deepEqual(officeNav('http://127.0.0.1:4777/#reports', ''), { hash: '' });
});
test('officeNav: off the office page (/town) reload "/" with the view', () => {
  assert.deepEqual(officeNav('http://127.0.0.1:4777/town', 'usage'), { load: true, hash: 'usage' });
  assert.deepEqual(officeNav('http://127.0.0.1:4777/town', ''), { load: true, hash: '' });
  assert.deepEqual(officeNav('', 'today'), { hash: 'today' }); // unparsable url: keep old behaviour
});
