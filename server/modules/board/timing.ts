import { type BoardStatus, LATENESS } from './schema';

/*
 * How each card is doing against the clock (A2.5, U8, design 2.5). Whole minutes, rounded
 * down, counted from the server's clock: pass `now` as the device time corrected by the
 * snapshot's `asOf` offset (B14). Pure, so the server, the browser and the tests agree.
 */

export type Tone = 'ok' | 'soon' | 'late';

export type CardTiming =
  /** New: "Waiting 2 min", "Late · waiting 6 min". */
  | { kind: 'waiting'; minutes: number; tone: Tone }
  /**
   * Accepted, Preparing: "23 min left", "Due in 3 min", "Late 10 min". `minutesLeft` before the
   * ready-by, `lateMinutes` after it; both null without a ready-by.
   */
  | {
      kind: 'readyBy';
      readyBy: string | null;
      minutesLeft: number | null;
      lateMinutes: number | null;
      tone: Tone;
    }
  /** Ready: "Ready 4 min", "Waiting 16 min for pickup". */
  | { kind: 'ready'; minutes: number; tone: Tone }
  /** Out for delivery: "Out 12 min". */
  | { kind: 'out'; minutes: number; tone: 'ok' };

export interface TimedCard {
  status: BoardStatus;
  placedAt: string;
  readyAt: string | null;
  pickedUpAt: string | null;
  readyBy: string | null;
}

const MINUTE_MS = 60_000;
const minutesSince = (iso: string, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / MINUTE_MS));

export function cardTiming(
  card: TimedCard,
  now: Date,
  thresholds: typeof LATENESS = LATENESS,
): CardTiming {
  switch (card.status) {
    case 'PLACED': {
      const minutes = minutesSince(card.placedAt, now);
      const tone: Tone =
        minutes >= thresholds.newRedMinutes
          ? 'late'
          : minutes >= thresholds.newAmberMinutes
            ? 'soon'
            : 'ok';
      return { kind: 'waiting', minutes, tone };
    }
    case 'ACCEPTED':
    case 'PREPARING': {
      if (!card.readyBy) {
        return { kind: 'readyBy', readyBy: null, minutesLeft: null, lateMinutes: null, tone: 'ok' };
      }
      const leftMs = new Date(card.readyBy).getTime() - now.getTime();
      if (leftMs < 0) {
        return {
          kind: 'readyBy',
          readyBy: card.readyBy,
          minutesLeft: null,
          lateMinutes: Math.floor(-leftMs / MINUTE_MS),
          tone: 'late',
        };
      }
      return {
        kind: 'readyBy',
        readyBy: card.readyBy,
        minutesLeft: Math.floor(leftMs / MINUTE_MS),
        lateMinutes: null,
        tone: leftMs <= thresholds.dueSoonMinutes * MINUTE_MS ? 'soon' : 'ok',
      };
    }
    case 'READY': {
      const minutes = minutesSince(card.readyAt ?? card.placedAt, now);
      const tone: Tone =
        minutes >= thresholds.readyRedMinutes
          ? 'late'
          : minutes >= thresholds.readyAmberMinutes
            ? 'soon'
            : 'ok';
      return { kind: 'ready', minutes, tone };
    }
    case 'PICKED_UP':
    default:
      return {
        kind: 'out',
        minutes: minutesSince(card.pickedUpAt ?? card.placedAt, now),
        tone: 'ok',
      };
  }
}

/** Counted in the column header's "1 late" and filtered by "Late only" (A2.1, A11.2). */
export const isLate = (timing: CardTiming) => timing.tone === 'late';
