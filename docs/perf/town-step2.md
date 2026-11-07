# Town step 2 perf results (office page)

Run with `electron perf/office-perf.cjs` (visible 1280x800 window, temp profile, port 4794, the shipped office atlas). It exits 1 if a budget breaks, and the raw JSON goes to `perf/results/` (git-ignored). The live checks are in `perf/office-check.cjs`: a custom saved layout, a Build-mode drag, and the atlas blocked.

Machine: AMD Ryzen 7 4800H (16 threads), NVIDIA GeForce RTX 3050 Laptop GPU (plus AMD Radeon iGPU), 23.4 GB RAM, Windows 11 (10.0.26200), Electron 43.7.7. It is a shared laptop with other apps running.

| Measure | Result (two final runs) | Budget | Step 1 town |
|---|---|---|---|
| Idle renderer CPU (10 s mean / worst 1 s sample) | 0.12% / 0.23%; 0.13% / 0.30% | < 3% | 0.00% |
| Idle frames in 10 s | 20; 20 | power-saver idle cadence, one per 500 ms (<= 21) | 0 |
| Draw time, preview `work` scene (p50 / p95 / max, about 225 frames) | 4.2 / 11.0 / 16.1 ms; 4.3 / 11.8 / 17.5 ms | p95 < 8 ms | 0.6-0.8 / 1.2-2.8 ms (walking) |
| Renderer private memory, work scene | 89 MB; 86 MB | < 250 MB | about 56 MB |
| Renderer private memory, after the cycles | 80 MB; 83 MB | < 250 MB | n/a |
| 20 town <-> office cycles, renderer cache cleared (first -> last) | 70 -> 80 MB (+13.8%); 73 -> 83 MB (+13.9%) | within +-10% | n/a |
| 20 town <-> karinderya + game hall cycles, cache cleared (info) | 83 -> 94 MB (+13.3%); 85 -> 92 MB (+8.2%) | (info) | n/a |

Two budgets miss on this machine. **Both misses are also present before this step's changes.** The same harness, run with the base commit's `office-furniture.js`, measured:
- draw p50 3.4 ms and p95 6.3 ms;
- cycle drift +15.7%.

Interleaved 30 s runs of the work scene, new / base / new / base, gave these p95 values:
- new: 10.1 ms, then 6.0 ms;
- base: 6.2 ms, then 11.0 ms.

The p50 was 3.9 to 4.1 ms in every run.

- **Draw p95.** The median frame takes about 4 ms. On both versions, p95 swings between about 6 ms and about 11 ms from run to run. It comes from lone 10 to 17 ms frames with no pattern in time or agent movement, most likely GC or OS scheduling on a shared laptop. It is not a cost of the sprite art.
  - Idle office (no `work` scene) is far below that.
  - The office draws at most about 7.5 frames a second in the `work` scene, because power saver uses the 125 ms "active" cadence.
- **Cycle memory.** Without clearing the renderer cache, the raw drift is noisy: about -9% to +33%. Chromium keeps the decoded atlases and resources of earlier pages in the renderer's memory cache, and that cache grows over the first visits. The harness therefore samples after `webFrame.clearCache()` and a GC, and reports the raw number beside it.
  - What remains is a creep of about 0.25 to 0.5 MB per interior visit.
  - DevTools counters stay flat across the visits: 1 document, 66 DOM nodes, 24 JS listeners.
  - A heap snapshot diff over 10 visits attributes the JS growth to V8, Blink and Electron binding internals: `FunctionTemplateInfo`, `ObjectTemplateInfo`, `InterceptorInfo`, and the binding functions `open`, `close` and `writeBuffer`. It also shows one `NavigationHistoryEntry` per navigation.
  - None of the app's objects, canvases or listeners grow.
  - Town-only reloads stay flat, at 55 MB over 30 cycles.

All other budgets pass with a wide margin.
