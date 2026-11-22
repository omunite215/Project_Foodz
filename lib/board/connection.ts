import { BOARD_POLL_MS, BOARD_REFRESH_MS } from '@/server/modules/board/schema';
import type { RealtimeStatus } from '@/lib/realtime/status';

/*
 * The board's connection state (F5 design 2.12, A12): what the live chip says, which banner
 * shows, and how often the board refreshes itself. Pure, from the realtime status and the
 * clock, so every threshold is tested.
 */

export type ConnectionKind =
  /** Events arrive (or a drop is under 5 seconds old). */
  | 'live'
  /** Dropped 5 to 30 seconds ago: "Live updates paused." */
  | 'paused'
  /** Dropped over 30 seconds ago: "The board may be out of date." */
  | 'outOfDate'
  /** Reconnected; the fresh copy hasn't arrived yet, so the chip doesn't say "Live" (A12.3). */
  | 'catchingUp'
  /** Realtime isn't set up or was refused: refresh every 10 seconds (A12.6). */
  | 'polling'
  | 'offline'
  | 'signedOut';

/** A drop shorter than this changes nothing on screen. */
export const PAUSED_AFTER_MS = 5_000;
export const OUT_OF_DATE_AFTER_MS = 30_000;
/** A first connection that hasn't come up by now counts as "not available". */
export const FIRST_CONNECT_MS = 10_000;

export interface ConnectionInput {
  /** The snapshot's `realtime.configured`. */
  configured: boolean;
  realtime: RealtimeStatus;
  online: boolean;
  /** An action or refresh answered UNAUTHENTICATED. */
  signedOut: boolean;
  /** Has realtime been connected at least once since the board opened? */
  everConnected: boolean;
  /** When the connection was last lost; null while connected. */
  droppedAt: number | null;
  /** When the board started listening. */
  startedAt: number;
  /** Reconnected and waiting for the fresh copy. */
  catchingUp: boolean;
  now: number;
}

export function connectionKind(input: ConnectionInput): ConnectionKind {
  if (input.signedOut || input.realtime === 'signedOut') return 'signedOut';
  if (!input.online) return 'offline';
  if (!input.configured || input.realtime === 'unavailable') return 'polling';
  if (input.realtime === 'connected') return input.catchingUp ? 'catchingUp' : 'live';
  if (!input.everConnected) {
    return input.now - input.startedAt < FIRST_CONNECT_MS ? 'live' : 'polling';
  }
  const lost = input.now - (input.droppedAt ?? input.now);
  if (lost < PAUSED_AFTER_MS) return 'live';
  if (lost < OUT_OF_DATE_AFTER_MS) return 'paused';
  return 'outOfDate';
}

/**
 * How often the board fetches a fresh copy by itself: every 60 seconds while live (A12.4),
 * every 10 seconds while realtime is down (A12.6); not at all offline or signed out.
 */
export function refreshInterval(kind: ConnectionKind): number | false {
  switch (kind) {
    case 'live':
      return BOARD_REFRESH_MS;
    case 'offline':
    case 'signedOut':
      return false;
    default:
      return BOARD_POLL_MS;
  }
}

/** The banner each state shows (design 1.5); one connection banner at a time. */
export type ConnectionBanner = 'paused' | 'outOfDate' | 'noRealtime' | 'offline' | null;

export function connectionBanner(kind: ConnectionKind): ConnectionBanner {
  switch (kind) {
    case 'paused':
      return 'paused';
    case 'outOfDate':
      return 'outOfDate';
    case 'polling':
      return 'noRealtime';
    case 'offline':
      return 'offline';
    default:
      return null;
  }
}

/** The live chip's words (design 1.4). */
export type LiveChipState = 'live' | 'reconnecting' | 'notLive' | 'offline' | 'signedOut';

export function liveChipState(kind: ConnectionKind): LiveChipState {
  switch (kind) {
    case 'live':
      return 'live';
    case 'paused':
    case 'outOfDate':
    case 'catchingUp':
      return 'reconnecting';
    case 'polling':
      return 'notLive';
    case 'offline':
      return 'offline';
    case 'signedOut':
    default:
      return 'signedOut';
  }
}
