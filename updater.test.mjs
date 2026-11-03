import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { compareVersions, isNewer, parseManifest, makeAssetPolicy, verifyManifestSignature, checkForUpdate, downloadUpdate, verifyBeforeLaunch, makeUpdateDir, applyUpdatePatch, resolveFeed, keyFingerprint, DEFAULT_FEED } from './desktop/updater.mjs';
import { RELEASE_PUBLIC_KEY, RELEASE_KEY_FINGERPRINT } from './desktop/update-key.mjs';
import { createRestartPolicy, restartLogLine } from './desktop/restart-policy.mjs';

test('compareVersions orders numerically, not lexically', () => {
  assert.equal(compareVersions('1.1.5', '1.1.5'), 0);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('v1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.1.5', '2.0.0'), -1);
});
test('pre-releases sort below the release; invalid yields null', () => {
  assert.equal(compareVersions('1.2.0-beta.1', '1.2.0'), -1);
  assert.equal(compareVersions('1.2.0-beta.2', '1.2.0-beta.10'), -1);
  assert.equal(compareVersions('1.2.0-alpha', '1.2.0-alpha.1'), -1);
  assert.equal(compareVersions('latest', '1.0.0'), null);
  assert.equal(isNewer('garbage', '1.0.0'), false);
  assert.equal(isNewer('1.1.6', '1.1.5'), true);
});
