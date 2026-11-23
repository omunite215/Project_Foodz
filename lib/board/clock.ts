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

/**
 * When a snapshot was taken, on the device's clock: halfway through the request that brought it,
 * so a slow answer doesn't push the board's clock behind the server's by the whole wait.
 */
export const midpoint = (sentAt: number, receivedAt: number) => (sentAt + receivedAt) / 2;

/**
 * The end of the undo window on the board's clock (A4.7, A8.1). The server allows its window
 * from the moment it moved the order; counted here from when the move was sent, and never past
 * the server's own deadline, so a slow answer or a stale clock never offers an Undo the server
 * would refuse.
 */
export function undoDeadline(
  move: { at: string; undoUntil: string },
  sentAt: number,
  offset: number,
): string {
  const windowMs = Date.parse(move.undoUntil) - Date.parse(move.at);
  const fromSending = sentAt + offset + windowMs;
  return new Date(Math.min(fromSending, Date.parse(move.undoUntil))).toISOString();
}
