import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePermission, originOf } from './desktop/media-permissions.mjs';

const APP = 'http://localhost:4777', SPOT = 'https://open.spotify.com';
const rows = [
  ['mic from app origin, main window', { permission: 'media', origin: APP, isMainWindow: true, mediaTypes: ['audio'] }, true],
  ['audio+video', { permission: 'media', origin: APP, isMainWindow: true, mediaTypes: ['audio', 'video'] }, false],
  ['video only', { permission: 'media', origin: APP, isMainWindow: true, mediaTypes: ['video'] }, false],
  ['no media types', { permission: 'media', origin: APP, isMainWindow: true }, false],
  ['audio from Spotify', { permission: 'media', origin: SPOT, isMainWindow: true, mediaTypes: ['audio'] }, false],
  ['audio from non-main window', { permission: 'media', origin: APP, isMainWindow: false, mediaTypes: ['audio'] }, false],
  ['clipboard write, app origin', { permission: 'clipboard-sanitized-write', origin: APP }, true],
  ['clipboard write, other origin', { permission: 'clipboard-sanitized-write', origin: SPOT }, false],
  ['clipboard read, app origin', { permission: 'clipboard-read', origin: APP }, false],
  ['protected media from Spotify', { permission: 'mediaKeySystem', origin: SPOT }, true],
  ['protected media from app origin', { permission: 'mediaKeySystem', origin: APP }, false],
  ['geolocation', { permission: 'geolocation', origin: APP, isMainWindow: true }, false],
  ['notifications', { permission: 'notifications', origin: APP, isMainWindow: true }, false],
  ['openExternal', { permission: 'openExternal', origin: APP, isMainWindow: true }, false],
  ['empty permission', { permission: '', origin: APP, isMainWindow: true }, false],
  ['undefined permission', { permission: undefined, origin: APP, isMainWindow: true }, false],
  ['empty app origin never matches empty origin', { permission: 'clipboard-sanitized-write', origin: '', appOrigin: '' }, false],
];
for (const [name, a, want] of rows) test(name, () => assert.equal(decidePermission({ appOrigin: APP, ...a }), want));
test('originOf: trailing slash, full URL, junk', () => {
  assert.equal(originOf('http://localhost:4777/'), APP); assert.equal(originOf(APP + '/a?b#c'), APP);
  assert.equal(originOf('null'), ''); assert.equal(originOf(undefined), ''); assert.equal(originOf('x'), '');
});
