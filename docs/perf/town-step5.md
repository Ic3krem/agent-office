# Town step 5 results (places to wander)

Live checks run in Electron with a temp profile; none of them is part of `npm test`. Each prints ALL PASSED or exits 1.

- `perf/town-perf.cjs` (port 4799) now keeps 13 agents parked at the spots for the whole run (park: two on benches and two dog walkers; court: two shooters and two watchers; tree: two; waterfall: one; pasture: two at the fence), so idle, walk and hidden are all measured with visitors and animals present. The walk now climbs two ramps: the west one onto the park terrace, then the east one between the court and the pasture (twice each). Results are written to `perf/results/town-step5-<date>.json`.
- `perf/town-check.cjs` walks the player into each spot and up to the plaza fountain: one bubble with that place's line, none again on a second walk-in within the 60 s cooldown. It checks that parked visitors draw at their points on High (Pixi) and Low (Canvas2D), and that no frame is drawn in 3 s with ambient off (Low, and High with `data-anim=off`) while visitors and animals are present.
- `perf/travel-check.cjs` adds an idle agent on an empty board whose `statusAt` hashes to a spot: it walks out, parks at its activity point (not moving, in the town only), and walks home to its desk when it gets work.

Machine: as in `town-step4.md` (AMD Ryzen 7 4800H, RTX 3050 Laptop GPU, 23.4 GB, Windows 11, Electron 43.8.7). Power saver on, so High's ambient cap is 8 fps.

| Measure | Result (two runs) | Budget |
|---|---|---|
| Low: town idle CPU (10 s mean, 13 visitors) | 0.00%; 0.00% | < 1% |
| High: town idle CPU (ambient at 8 fps, visitors and animals moving) | 0.53%; 0.53% | < 3% |
| Low: town idle frames in 10 s | 0; 0 | 0 |
| High: town idle frames in 10 s (ambient, information only) | 81; 81 | (8 fps cap) |
| Low / High: town hidden frames (10 s, scene dirtied every 100 ms) | 0 / 0; 0 / 0 | 0 |
| Low / High: town hidden CPU | 0.03 / 0.03%; 0.02 / 0.03% | < 0.5% |
| Low: town walk up two ramps (park, court), draw p95 (about 1440 frames) | 0.6 ms; 0.6 ms | < 16 ms |
| High: town walk up two ramps, draw p95 | 2.8 ms; 2.2 ms | < 8 ms |
| Low: town renderer private | 66.5 MB; 65.9 MB | < 180 MB |
| High: town renderer private | 70.2 MB; 69.5 MB | < 250 MB |
| Low / High: `stats().textureBytes` | 20.1 / 20.1 MB; 20.1 / 20.1 MB | < 48 / < 96 MB |
| Low: office idle CPU / frames in 10 s | 0.00% / 0; 0.00% / 0 | < 1% / <= 21 |
| High: office idle CPU / frames in 10 s | 0.09% / 20; 0.09% / 19 | < 3% / <= 21 |
| Low / High: office work scene draw p95 | 4.5 / 4.2 ms; 4.2 / 3.7 ms | < 8 ms |
| Low / High: office renderer private (work scene) | 96.4 / 97.4 MB; 90.8 / 94.4 MB | < 180 / < 250 MB |
| 40 town <-> office cycles: JS heap after `gc()`, worst cycle against cycle 1 | 1.2%; 1.2% (7.4-7.5 MB; 7.2 MB before step 5) | within +-10% |
| 40 town <-> office cycles: renderer private slope (cache cleared) | 0.279; 0.260 MB per cycle | <= 0.3 |
| Shipped art (`public/art`) | 0.49 MB | < 8 MB |

The interiors pair (20 town <-> karinderya + game hall cycles) is reported, not budgeted: heap worst 1.2% and 1.5%, private slope 0.31 and 0.38 MB per cycle (0.30 on the code before step 5, one run).

## Findings fixed during the live checks

1. **A parked agent cost a frame per stream update on Low.** The town page re-sends the traveller list on every agent stream message. With agents parked at spots the list is never empty, so the Canvas2D renderer drew one frame per message (1 idle frame in 10 s, against a budget of 0). Both renderers now skip a list whose content (`TownRender.travSig`) is the same as the last one.
2. **The animals' A\* showed up in the JS heap.** Each animal planned its walk with `WorldPath.findPath` once per 20 s epoch, and each search allocates grid-sized scratch arrays. The office-perf cycle sample, taken on the town page, caught that garbage now and then: one sample 1.1 MB high, 14% against the +-10% budget, in two runs of two. Animals now walk a straight line on open cells (`WorldPath.lineClear`) from their anchor; the worst cycle is back to 1.2%.
3. **The tree of life was cut off at the top of the screen.** The camera never shows above the terrain image, and the tree's crown at (190, 98) on the high terrace reached past it. The tree moved to (310, 150), still on the highest terrace, and sits 2 units lower; a test now checks the crown stays inside the terrain view.
