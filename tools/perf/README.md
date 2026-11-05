# Performance measuring

How the render-cost numbers in the 1.2.8 changelog were taken. No script here needs a server, the installed app or a real profile.

## Quick check: the office canvas in a scratch page

A tiny Electron page loads the four `public/office-*.js` files, mounts `OfficeWorld` on a canvas, feeds it a snapshot and counts `clearRect` calls (one per drawn frame) while reading each process's CPU from `app.getAppMetrics()`:

- scenes: idle (all agents seated, nothing to do), working (the demo "work" snapshot), moving (the demo "tour");
- warm up 20 s so walkers have settled, then sample 10 s;
- start Electron with `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`, otherwise a window on a locked or remote desktop reports `document.hidden` and nothing draws;
- report frames per minute, GPU process % of one core and renderer % of one core.

`office-world.js` also exposes `OfficeWorld.framesDrawn()` for the same count from DevTools.

## Whole installed app

A baseline was taken from an installed build by running each window (office, Tiro, island) with `show: false`, positioned off screen, sampling per-process CPU for 10 to 15 s, then re-running with CSS or JS overrides injected (all CSS animations off, drop-shadow off, canvas capped to 15 or 8 fps) to see which part costs what. Those scripts embed local install paths and a demo profile, so they are not copied into the repository; the recipe above is enough to rebuild them. Results used for this change: dashboard canvas about 3% GPU per frame per second; Tiro's drop-shadow alone about 15 points; the island edge glow about 12 points; hidden or minimised windows cost nothing.

## Tests

`office-motion.test.mjs` holds the pure scheduler tests (`nextFrameDelay`, `frameWait`) and a fake-clock frame budget: idle at most about 2 frames a second, seated animations at most 8, moving about 30, hidden zero, a hover storm capped near 60.

## Numbers from this change (scratch pages, one core = 100%)

| case | before | after |
|---|---|---|
| office canvas, idle, visible | 25 fps, 97% GPU, 24% renderer | 2 fps, 7.5% GPU, 1.7% renderer |
| office canvas, agents working | 23.5 fps, 101% GPU | 8.6 fps, 38% GPU |
| Tiro window, idle | 49% GPU | 2.5% GPU |
| Tiro window, working | 68% GPU | 41% GPU |
| island, idle, collapsed | 45% GPU | 0.2% GPU |

Not done: caching static furniture layers (the canvas still repaints every painter on each drawn frame), so a frame is as expensive as before; the saving comes from drawing far fewer of them. While characters travel the canvas still draws up to 30 fps.
