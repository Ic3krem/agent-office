// Backoff policy for restarting the office server child process when it crashes. Pure, so it is testable.
// Each crash waits longer (1s, 2s, 4s ... capped); a child that stayed up for stableMs resets the counter; after maxTries consecutive
// quick crashes we give up and let the tray tell the user instead of looping forever.
export const RESTART_DEFAULTS = { maxTries: 5, baseMs: 1000, capMs: 30000, stableMs: 60000 };
export function createRestartPolicy(opts = {}) {
  const o = { ...RESTART_DEFAULTS, ...opts };
  let tries = 0;
  return {
    // Called when the child exits; ranMs = how long it had been running. Returns { retry, delayMs, attempt }.
    onExit(ranMs) {
      if (ranMs >= o.stableMs) tries = 0;
      if (tries >= o.maxTries) return { retry: false, delayMs: 0, attempt: tries };
      const delayMs = Math.min(o.capMs, o.baseMs * 2 ** tries);
      tries += 1;
      return { retry: true, delayMs, attempt: tries };
    },
    reset() { tries = 0; },
    get tries() { return tries; },
  };
}
// A log line that never contains environment, arguments or keys: just the event, exit code/signal and attempt.
export const restartLogLine = (when, ev) => `${new Date(when).toISOString()} server ${ev.event}${ev.error ? ' error=' + String(ev.error).replace(/[^A-Z0-9_]/gi, '') : ''}${ev.code != null ? ' code=' + Number(ev.code) : ''}${ev.signal ? ' signal=' + String(ev.signal).replace(/[^A-Z0-9]/gi, '') : ''}${ev.attempt != null ? ' attempt=' + Number(ev.attempt) : ''}${ev.delayMs != null ? ' retryInMs=' + Number(ev.delayMs) : ''}`;
