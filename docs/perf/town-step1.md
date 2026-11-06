# Town step 1 perf results

Run with `npm run perf:town` (Electron, visible 1280x800 window, temp profile, port 4799). Exits 1 if a budget breaks; raw JSON goes to `perf/results/` (git-ignored).

Machine: AMD Ryzen 7 4800H (16 threads), NVIDIA GeForce RTX 3050 Laptop GPU (plus AMD Radeon iGPU), 23.4 GB RAM, Windows 11 (10.0.26200), Electron 43.7.7. Shared laptop with other apps running.

| Measure | Result | Budget |
|---|---|---|
| Idle renderer CPU (10 s mean / worst 1 s sample) | 0.00% / 0.00% | < 3% |
| Idle frames rendered in 10 s | 0 | 0 |
| Hidden renderer CPU (10 s mean / worst 1 s sample) | 0.02% / 0.19% | < 0.5% |
| Hidden frames rendered in 10 s | 0 | 0 |
| Walking render time p50 / p95 | 0.6-0.8 ms / 1.2-2.8 ms | p95 < 8 ms |
| Renderer private memory | about 56 MB | < 250 MB |
| GPU process working set (info only) | about 120 MB | n/a |
| textureBytes | 16.3 MB | < 96 MB |
| Draw calls / sprites | 2 / 510 | n/a |

Numbers are from three consecutive runs; all budgets passed with wide margin.
