#!/usr/bin/env node
// A stand-in for Codex, Gemini CLI and OpenCode in tests and live harnesses. It never calls a model.
//   --version            print "fake-cli 1.2.3"
//   (default)            echo {argv, stdin} as JSON on one line
//   --codex              also print a Codex JSONL agent_message whose text is "echo: <stdin or last arg>"
//   --sleep <ms>         wait before answering          --exit <n>   exit with code n (after printing to stderr)
//   --spew <MB>          print that many MB first       --grandchild spawn a child that sleeps 60 s
//   --pidfile <file>     write {pid, grandchild} there
//   --json (codex exec)  same as --codex. Stdin starting "SLEEP <ms>" waits that long first (the live Stop check).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const argv = process.argv.slice(2), opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; }, has = n => argv.includes(n);
if (has('--version')) { process.stdout.write('fake-cli 1.2.3\n'); process.exit(0); }
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', main);
if (process.stdin.isTTY) main();
let started = false;
async function main() {
  if (started) return; started = true;
  const stdin = Buffer.concat(chunks).toString('utf8');
  let gc = null;
  if (has('--grandchild')) gc = spawn(process.execPath, [fileURLToPath(import.meta.url), '--sleep', '60000'], { stdio: 'ignore', windowsHide: true });
  if (opt('--pidfile')) fs.writeFileSync(opt('--pidfile'), JSON.stringify({ pid: process.pid, grandchild: gc && gc.pid }));
  const mb = Number(opt('--spew') || 0), line = 'x'.repeat(1023) + '\n';
  for (let i = 0; i < mb * 1024; i++) if (!process.stdout.write(line)) await new Promise(r => process.stdout.once('drain', r));
  const sl = /^SLEEP (\d+)/.exec(stdin); if (sl) await new Promise(r => setTimeout(r, Number(sl[1])));
  if (opt('--sleep')) await new Promise(r => setTimeout(r, Number(opt('--sleep'))));
  process.stdout.write(JSON.stringify({ argv, stdin }) + '\n');
  if (has('--codex') || has('--json')) process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'echo: ' + (stdin || argv.at(-1)) } }) + '\n');
  if (opt('--exit')) { process.stderr.write('Error: fake failure ' + opt('--exit') + '\n'); process.exitCode = Number(opt('--exit')); }
}
