/*
 * Board timers count from the server's clock, never the tablet's alone (story B14): each
 * snapshot carries `asOf`, and the browser keeps the difference between it and its own clock.
 */

/** Milliseconds to add to the device's clock to get the server's. */
export const serverOffset = (asOf: string, receivedAt: number) => Date.parse(asOf) - receivedAt;

export const serverNow = (offset: number, deviceNow: number = Date.now()) =>
  new Date(deviceNow + offset);

/** Timers refresh at least every 15 seconds (A2.5). */
export const TIMER_TICK_MS = 15_000;

/** Milliseconds left until a server time, read on the device's clock. */
export const msUntil = (iso: string, offset: number, deviceNow: number = Date.now()) =>
  Date.parse(iso) - (deviceNow + offset);
