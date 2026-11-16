import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { privateTerms } from './private-terms.mjs';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');

const bad = privateTerms();
test('no private names (employer, clients, machines) in any tracked text file', { skip: !bad && 'no private terms file (see private-terms.mjs)' }, () => {
  const root = fileURLToPathSafe();
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter(f => !/^(node_modules|docs\/images|public\/vendor|public\/fonts|package-lock\.json)/.test(f) && !/\.(png|woff2|ico|jpg)$/i.test(f));
  for (const f of files) {
    let t = fs.readFileSync(path.join(root, f), 'utf8');
    // no exemptions: the publisher is the Ic3krem handle, so package.json is checked like every other file
    const m = t.match(bad);
    assert.ok(!m, f + ' mentions "' + (m && m[0]) + '"');
  }
});
function fileURLToPathSafe() { return decodeURIComponent(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).replace(/\/$/, ''); }

test('README points to the public releases, how to verify them, and building from source', () => {
  const r = read('./README.md');
  assert.match(r, /github\.com\/Ic3krem\/agent-office\/releases\/latest/); assert.match(r, /build it from source/i);
  assert.match(r, /AGENT_OFFICE_VERIFY_ONLY/);
  assert.doesNotMatch(r, /by invitation|repository is private/i);
  assert.doesNotMatch(r, /Tiro cannot hire/); assert.match(r, /best-effort/); assert.match(r, /not a sandbox/);
  assert.doesNotMatch(read('./docs/GUIDE.md') + read('./docs/agents-and-memory.md'), /Tiro cannot start a specialist/);
});

test('install scripts say plainly when the release page is missing or unreachable, without a stack trace', () => {
  const ps = read('./install.ps1'), sh = read('./install.sh');
  for (const s of [ps, sh]) { assert.match(s, /may not exist, or GitHub is not reachable/); assert.match(s, /agent-office\/releases/); assert.doesNotMatch(s, /by invitation/); } assert.match(ps, /\$code -eq 401 -or \$code -eq 403 -or \$code -eq 404/);
  assert.match(ps, /\$failed = \$true; Write-Host "Install stopped:/); assert.match(ps, /if \(\$failed\) \{ return \}/, 'stops cleanly (return, not exit) so a piped run does not close the shell');
  assert.ok(ps.indexOf('if ($failed) { return }') < ps.indexOf('Start-Process $exe.FullName'), 'a failed install never reports success');
  assert.match(sh, /401\|403\|404\) fail "GitHub answered \$code/);
  assert.match(sh, /-w '%\{http_code\}'/);
});

test('CodeQL and dependency review are skipped, not failed, on a private repository; npm audit and CI still run', () => {
  const cq = read('./.github/workflows/codeql.yml'), sc = read('./.github/workflows/security.yml');
  assert.match(cq, /if: github\.event\.repository\.private == false/);
  assert.match(sc, /if: github\.event_name == 'pull_request' && github\.event\.repository\.private == false/);
  const audit = sc.slice(sc.indexOf('npm-audit:'));
  assert.doesNotMatch(audit, /repository\.private/, 'the npm audit job runs on private repositories too');
  assert.ok(fs.existsSync(new URL('./.github/workflows/ci.yml', import.meta.url)));
});

test('lyrics are opt-in end to end: default off in the logic, the page and the docs; migration runs at start; now playing sends nothing', () => {
  const main = read('./desktop/main.mjs'), page = read('./public/island.html');
  assert.match(main, /migrateLyricsPrefs\(migrateNotchPrefs\(readForWrite\(KIRO_FILE/);
  assert.match(page, /animate: true, powerSaver: true, lyrics: false, notchEnabled/); assert.match(page, /S\.lyrics === true/);
  assert.match(page, /Lyrics are off until you turn them on/);
  assert.match(read('./docs/GUIDE.md'), /Lyrics are \*\*off by default\*\*/); assert.match(read('./docs/island-spec.md'), /default off since 1\.2\.8/);
  assert.match(read('./README.md'), /off by default: turning it on looks songs up at lrclib\.net/);
  const np = read('./desktop/nowplaying.mjs') + read('./desktop/nowplaying.ps1');
  assert.doesNotMatch(np, /\bfetch\(|https?:\/\/|net\.http|WebClient|Invoke-WebRequest|Invoke-RestMethod/i, 'the now-playing reader makes no network request');
  // the only network use of the media features is the lyrics client, and it is gated by the pref
  assert.match(main, /s\.lyrics && s\.nowPlaying && nowPlaying/);
});

test('docs keep an open to-do list for the old screenshots, the repo description and the public host', () => {
  const r = read('./docs/RESOURCES.md');
  assert.match(r, /Open to-dos for the docs/); assert.match(r, /Old screenshots/); assert.match(r, /Repo description/); assert.match(r, /Distribution host/);
});
