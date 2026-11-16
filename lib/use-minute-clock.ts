import { useSyncExternalStore } from 'react';

const MINUTE_MS = 60_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    for (const notify of listeners) notify();
  }, MINUTE_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** The current time, rounded down to the minute. */
function currentMinute() {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
}

/**
 * The time now, to the minute, updated once a minute: for countdowns that must not tick every
 * second. All components share one timer.
 */
export function useMinuteClock(): number {
  return useSyncExternalStore(subscribe, currentMinute, currentMinute);
}
