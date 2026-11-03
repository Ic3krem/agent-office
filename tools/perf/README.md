# Performance measurement

Everything here is read-only against your own transcripts and never touches port 4777 or an installed app.

## Scan cost (no setup)

```
node tools/perf/measure-scan.mjs                # uses ~/.claude/projects
node tools/perf/measure-scan.mjs /path/to/projects
```

It counts file-system calls for the previous per-second scan (reproduced call for call) and for the gated scanner in `perf.mjs`, over 600 simulated seconds on your real tree, and prints one JSON line: calls per tick before, calls over 10 minutes after, the average per second, how many transcripts are "hot", and the reduction factor. On the development PC (about 800 transcripts): about 1,800 calls per second before, about 10 after.

## Unit-level checks

`npm test` includes `perf.test.mjs`: fake file systems with call counters (an untouched 1,200-file tree costs zero calls between cold ticks), the snapshot gate and size budget, ledger offsets and chunked reads, probe gating, the idle-session state machine, bounded sets and the lyrics cache cap.

A slow heap check is opt-in:

```
AO_LEAK=1 node --expose-gc --test perf.test.mjs
```

It streams 50,000 transcript lines through the parser and fails if the heap grows by more than 8 MB between 10k and 50k lines.

## Whole-process measurement (CPU, RSS, SSE bytes, startup spike)

Run the packaged server in isolation, never next to your real data: set `ELECTRON_RUN_AS_NODE=1`, a temporary `USERPROFILE`/`HOME`, `AGENT_OFFICE_PORT` to a spare port and `AGENT_OFFICE_UI_KEY` to any 32+ character string, start `Agent Office.exe resources\app.asar\server.mjs`, then sample the process with your usual tool (Task Manager, `Get-Process`, `ps`) and read `/api/stream` with the cookie `ao_ui=<that key>` to measure push size and rate. Compare idle CPU, resident memory after 10 minutes, memory right after start, and bytes per push at 8 agents before and after.

Guerra's full harness (instrumented server copy, renderer profiles, installed-app sampling) lives outside the repository because it contains machine-specific paths; its README line is: edit the paths at the top of `run-all.ps1` to your build and temp folder, then run it.
