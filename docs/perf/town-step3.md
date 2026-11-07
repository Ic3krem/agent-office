# Town step 3 results (travellers)

Live checks run in Electron with a temp profile; none of them is part of `npm test`. Each prints ALL PASSED or exits 1.

- `perf/travel-check.cjs [shot dir]` (port 4796). A preload merges fake agents (and a fake party) into the real agent stream; the fake state sits in localStorage, so every window of the origin sees the same agents. It checks:
  - one agent at its desk goes limited: the office shows it walking out, and it is gone after the exit leg;
  - the town shows it on the road, wearing its role look; after a reload mid-walk it is within one grid cell (10 units) of where its trip had it;
  - the karinderya shows it seated on a stool with a chismis line while the cook talks, and clicking it opens its desk card;
  - the office page stays at its idle cadence while the agent is away;
  - the limit clears: it leaves the karinderya, walks the road home and sits at its desk again;
  - a party friend's limited agent walks from the friend-1 door to the karinderya and sits or stands there;
  - the town walk with 8 travellers on the road at once (a visible window that never takes focus, native occlusion off), then the town draws nothing once they have left.
- `perf/scene-check.cjs` now allows travellers in an interior (an own agent whose trip goes to that lot, or a party friend's agent).
- `perf/office-check.cjs` is unchanged.

Machine: as in `town-step2.md` (AMD Ryzen 7 4800H, RTX 3050 Laptop GPU, 23.4 GB, Windows 11, Electron 43.7.7), a shared laptop with other apps running.

| Measure | Result (two runs) | Budget |
|---|---|---|
| Town walk with 8 travellers, draw time p50 / p95 / max (about 600 frames in 5.1 s) | 0.50 / 0.90 / 1.30 ms; 0.50 / 0.80 / 1.50 ms | p95 < 8 ms |
| Town idle after the travellers left (3 s) | 0 frames; 0 frames | 0 |
| Office page idle while its agent is at the karinderya (10 s) | 10 frames; 10 frames | <= 21 (power-saver cadence) |
| Reload of the town mid-walk: distance from the trip's position | 0 units; 0 units | <= 10 (one grid cell) |
| `perf/office-perf.cjs`: office idle CPU (10 s mean / worst 1 s) | 0.26% / 2.06%; 0.08% / 0.24% | < 3% |
| `perf/office-perf.cjs`: office idle frames in 10 s | 19; 20 | <= 21 |
| `perf/office-perf.cjs`: work scene draw p95 | 3.0 ms; 3.5 ms | < 8 ms |
| `perf/office-perf.cjs`: 20 town <-> office cycles, cache cleared | 69 -> 81 MB (+18.1%); 71 -> 80 MB (+12.8%) | within +-10% |

The office idle budget is still met. The cycle drift is the miss already recorded for step 2 (+13.8% and +13.9% there; +18.1% and +12.8% in these two runs), deferred to step 4; it is reported here as measured and not changed.

## Harness notes

- Every window shares one Electron session, so the fake agents and the trip records (`ao.trips`, `ao.friendTrips`) are shared the way two real windows of one office share them.
- An interior's `OfficeMotion.TEAM` is empty (it has no desks), so the fake agents carry the office's desk profiles read once from the office window.
- `perf/scene-check.cjs` failed at "town -> kain" on this machine before this step's changes too (at the step 3 base commit): after a navigation the hidden offscreen window had no keyboard focus, so the E key never reached the town page. The harness now calls `focusOnWebView()` before it sends keys when the page reports no focus. The checks themselves are unchanged.
