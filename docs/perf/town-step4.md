# Town step 4 results (graphics: memory drift and per-preset budgets)

Live checks run in Electron with a temp profile; none of them is part of `npm test`. Each prints ALL PASSED or exits 1.

- `perf/office-perf.cjs` (port 4794) now runs per graphics preset (Low, High), set with `Graphics.save` on the temp profile. For each preset it measures office idle CPU and frames, the 'work' scene draw p95 and renderer private memory. Then come 20 town <-> office cycles on High. The cycle budget is now the spec's measure: the JS heap (`performance.memory.usedJSHeapSize` after `gc()`) of every cycle stays within +-10% of cycle 1. Renderer private bytes stay reported, and over cycles 11-20 they must rise no more than 3%. That rise is the least-squares fit over those ten cycles, as a share of the fitted value at cycle 11, so one noisy sample cannot decide it. The harness also checks that the town page is not kept in the back/forward cache.
- `perf/town-perf.cjs` (port 4799) runs per preset: Low (Canvas2D, ambient off) and High (GPU, ambient at its fps cap). The walk starts at the foot of the ramp at x 620-680, climbs it onto the NW orchard terrace and comes back down, twice. It must reach terrace height (`TownMap.LEVEL_H`: 14 in Task 10, 28 since Task 9b).
- `perf/scene-check.cjs` "town idle renders nothing" and `perf/travel-check.cjs` "town idle after the travellers left" are pinned to Low (ambient off), as `perf/town-check.cjs` already was. travel-check adds two checks on High: the ambient layer runs at its `ambientFps` cap while visible, and stops while hidden.

Machine: as in `town-step2.md` (AMD Ryzen 7 4800H, RTX 3050 Laptop GPU, 23.4 GB, Windows 11), now Electron 43.8.7. It is a shared laptop with other apps running. The default power saver is on, so High's ambient cap is 8 fps.

| Measure | Result (two runs) | Budget |
|---|---|---|
| Low: town idle CPU (10 s mean) | 0.00%; 0.00% | < 1% |
| High: town idle CPU (ambient at 8 fps) | 0.45%; 0.45% | < 3% |
| Low: town idle frames in 10 s | 0; 0 | 0 |
| High: town idle frames in 10 s (ambient, information only) | 81; 81 | (8 fps cap) |
| Low / High: town hidden frames (10 s, scene dirtied every 100 ms) | 0 / 0; 0 / 0 | 0 |
| Low / High: town hidden CPU | 0.02 / 0.02%; 0.02 / 0.02% | < 0.5% |
| Low: town walk up a ramp onto a terrace, draw p95 (about 600 frames) | 0.3 ms; 0.3 ms | < 16 ms |
| High: town walk up a ramp onto a terrace, draw p95 | 1.5 ms; 1.5 ms | < 8 ms |
| Low: town renderer private | 61.7 MB; 61.2 MB | < 180 MB |
| High: town renderer private | 60.6 MB; 60.2 MB | < 250 MB |
| Low / High: `stats().textureBytes` | 18.6 / 18.6 MB; 18.6 / 18.6 MB | < 48 / < 96 MB |
| Low: office idle CPU / frames in 10 s | 0.06% / 20; 0.06% / 19 | < 1% / <= 21 |
| High: office idle CPU / frames in 10 s | 0.07% / 20; 0.08% / 21 | < 3% / <= 21 |
| Low / High: office work scene draw p95 | 2.8 / 3.0 ms; 2.9 / 3.1 ms | < 8 ms |
| Low: office renderer private (work scene) | 116.6 MB; 116.2 MB | < 180 MB |
| High: office renderer private (work scene) | 113.2 MB; 115.0 MB | < 250 MB |
| Town page kept in the back/forward cache | no; no | no |
| 20 town <-> office cycles: JS heap after `gc()`, worst cycle against cycle 1 | 7.14 -> 7.09 MB, 0.8%; 7.14 -> 7.09 MB, 0.8% | within +-10% |
| 20 town <-> office cycles: renderer private, cycles 11-20 rise (fit) | 81 -> 84 MB, 2.9%; 81 -> 82 MB, 2.8% | <= 3% |
| 20 town <-> office cycles: renderer private after 20 cycles | 83.7 MB; 82.0 MB | < 250 MB |

The interiors pair (20 town <-> karinderya + game hall cycles) is reported, not budgeted. Its JS heap is flat (7.03 MB, worst 0.0% and 0.1%). Its private bytes plateau measured -1.9% and 3.5%.

The plateau budget passes, but only just: 2.9% and 2.8% against 3%. A slow creep of about 0.2 MB per cycle is still there; see finding 4.

## Taller cliffs (Task 9b, `LEVEL_H` 14 -> 28)

One `perf/town-perf.cjs` run after the cliffs were doubled in height and the ramps lengthened. The orchard ramp is now `[620,380,680,540]`, so the walk starts just below it at (650, 548) instead of (650, 585). The hold time is unchanged (1.25 s, about 212 units), and the walk must reach terrace height, now 28.

| Measure | Taller cliffs (one run) | Budget |
|---|---|---|
| Low: town idle CPU / frames in 10 s | 0.00% / 0 | < 1% / 0 |
| High: town idle CPU (ambient at 8 fps) | 0.40% | < 3% |
| Low / High: town hidden frames / CPU | 0 / 0; 0.02 / 0.02% | 0; < 0.5% |
| Low: town walk up a ramp onto a terrace, draw p95 | 0.3 ms (593 frames, highest ground 28) | < 16 ms |
| High: town walk up a ramp onto a terrace, draw p95 | 1.4 ms (602 frames, highest ground 28) | < 8 ms |
| Low / High: town renderer private | 62.6 / 60.8 MB | < 180 / < 250 MB |
| Low / High: `stats().textureBytes` | 18.9 / 18.9 MB | < 48 / < 96 MB |

## Step 1 findings (diagnosis, before any fix)

Method:
- 40 town <-> office cycles, sampling renderer private bytes and the JS heap after `gc()`.
- V8 heap snapshots at cycles 5 and 40, diffed by constructor.
- A back navigation to the town, to test the back/forward cache.
- Chromium memory-infra dumps (`disabled-by-default-memory-infra`, detailed) at cycles 2, 5, 11, 20, 30 and 40. These show the renderer and GPU process allocators.

1. **The step 2/3 cycle drift was mostly the harness.**
   - With the old harness window (unsandboxed, no context isolation, a Node preload), the JS heap grew from 10.8 to 12.8 MB over 20 cycles (+18%) and to 14.8 MB over 40, about 0.1 MB per cycle.
   - The snapshot diff (cycle 5 to 40, +3.8 MB) was all V8/Node binding internals: `FunctionTemplateInfo` +1.73 MB (27k), code objects +1.08 MB (23k), `ArrayList` +0.45 MB, `FunctionTemplateRareData` and `ObjectTemplateInfo` +0.35 MB. An unsandboxed preload starts a Node environment on every navigation, and its templates are never freed.
   - With the app's own window settings (sandbox, context isolation, as in `desktop/main.mjs`), the JS heap is flat: 7.10 -> 7.08 MB over 40 cycles. The snapshot diff is +17 KB, which is 38 session-history entries and a few closure scopes.
   - Fix: the harness window now uses the app's settings, and the cache-clear hook goes through `contextBridge`.
2. **No back/forward cache.** After town -> office -> back, `pageshow` reported `persisted: false`, and a marker set on the town document was gone. The town is never kept hidden with its renderer. The pagehide/pageshow remount the plan allowed for is not needed, and was not added. office-perf now checks this on every run.
3. **Office atlas images kept in Chromium's decode cache (fixed in our code).**
   - Each office visit decoded the 2048x1199 `atlas.png` (9.37 MB of pixels) for canvas drawing. Chromium kept that decoded copy after the page was gone, as one more 9.37 MB discardable shared-memory segment in the renderer for every visit.
   - The renderer's `discardable` grew 18.7 -> 103 -> 187 -> 281 -> 375 MB at cycles 2, 11, 20, 30 and 40. Its `cc/image_memory` grew 56 -> 309 -> 412 -> 525 -> 637 MB.
   - Windows does not count this shared memory in private bytes, which is why private bytes showed only part of it.
   - Fix: `public/office-world.js` now draws the atlases (atlas, glow, shadow) as `ImageBitmap`s, made with `createImageBitmap` after load, and falls back to the `<img>` if that fails. After the fix, over 40 cycles:
     - renderer `discardable` is gone;
     - renderer `shared_memory` is flat at 57.5 MB;
     - `cc/image_memory` and the GPU process `gpu/transfer_cache` both level off at 225 MB by cycle 20 and stay there (225.1 MB at cycle 40). That is Chromium's GPU-side cache budget, and it lives in the GPU process.
   - The cost: the decoded atlases now live in renderer private memory while the office page is open. The work-scene private figure rose from about 75 MB to about 115 MB (Low budget 180). They are freed with the page.
4. **What is left: a slow private-bytes creep of about 0.2 MB per cycle.** The JS heap, Blink GC heap, malloc, PartitionAlloc and V8 allocator dumps are flat across cycles 20-40, so no tracked allocator owns it. With one WebGL context alive at a time (memory-infra shows a single `webgl/context_*`), it is not a GL context leak either. Fitted over cycles 21-40 it is about +5% (0.21-0.24 MB per cycle in three diagnosis runs). Over cycles 11-20, the budget window, it came to -1.4% to 2.9%. It is reported here as measured, not fixed.
5. **The intermittent office idle miss was outside input.**
   - In one run, High office idle drew 62 frames in 10 s. Per-250 ms logging showed real (`isTrusted`) `mousemove` events, 112 px back and forth every 20 s, from something on the machine outside the harness.
   - The office treats a mouse move as interaction and draws smoothly for 1.5 s, which is correct.
   - Fix: both perf windows now ignore OS mouse events (`setIgnoreMouseEvents(true)`). Keyboard input goes through `sendInputEvent` and is unaffected.
6. Listeners, intervals, `PIXI.Assets` and GL contexts: the heap diff shows no retained page objects (no documents, DOM nodes, listeners or Pixi objects). `textureBytes` stays 18.6 MB on every cycle, and memory-infra shows one WebGL context. There was nothing to fix there.

## Harness notes

- `perf/office-check.cjs` "both desks draw from the atlas" identified the atlas by its `src`. An `ImageBitmap` has none, so the check now compares against the image `OfficeFurniture.sprite` draws.
- The harnesses delete their temp profile on exit, but on Windows the delete often fails: the Electron process still holds files under its own `userData` inside that folder. Folders named `ao-<harness>-*` are left in the system temp folder. This happened before step 4 too.
