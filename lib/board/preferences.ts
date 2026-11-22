import type { BoardColumn } from '@/server/modules/board/schema';

/*
 * What the board remembers on this device only (F5 design, "Data shown"): sound, keep the
 * screen on, collapsed columns and the timeline's seconds. Never sent to the server. Storage can
 * be missing or refuse (private windows, blocked site data), so every read and write is
 * guarded and the board works without it.
 */

export const PREFERENCE_KEYS = {
  sound: 'foodz.board.sound',
  wakeLock: 'foodz.board.wake-lock',
  collapsed: 'foodz.board.collapsed',
  showSeconds: 'foodz.board.show-seconds',
} as const;

type Key = keyof typeof PREFERENCE_KEYS;

export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

function storage(given?: PreferenceStorage): PreferenceStorage | null {
  if (given) return given;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readPreference(key: Key, given?: PreferenceStorage): string | null {
  try {
    return storage(given)?.getItem(PREFERENCE_KEYS[key]) ?? null;
  } catch {
    return null;
  }
}

export function writePreference(key: Key, value: string, given?: PreferenceStorage): void {
  try {
    storage(given)?.setItem(PREFERENCE_KEYS[key], value);
  } catch {
    // Storage refused: the choice lasts until the page closes.
  }
}

/** On, off, or never chosen on this device (null: use the role's default). */
export function readSwitch(key: 'sound' | 'wakeLock' | 'showSeconds', given?: PreferenceStorage) {
  const value = readPreference(key, given);
  return value === 'on' ? true : value === 'off' ? false : null;
}

export const writeSwitch = (
  key: 'sound' | 'wakeLock' | 'showSeconds',
  on: boolean,
  given?: PreferenceStorage,
) => writePreference(key, on ? 'on' : 'off', given);

const COLUMNS: readonly BoardColumn[] = ['new', 'accepted', 'preparing', 'ready', 'outForDelivery'];

/**
 * Columns collapsed on this device, and the ones expanded on purpose (so "Out for delivery"
 * stays open once someone opened it on a narrow screen). Null when never chosen.
 */
export interface CollapsedColumns {
  collapsed: BoardColumn[];
  expanded: BoardColumn[];
}

export function readCollapsed(given?: PreferenceStorage): CollapsedColumns | null {
  const raw = readPreference('collapsed', given);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const pick = (field: string): BoardColumn[] => {
      const value: unknown = field in parsed ? Reflect.get(parsed, field) : undefined;
      return Array.isArray(value) ? COLUMNS.filter((column) => value.includes(column)) : [];
    };
    return { collapsed: pick('collapsed'), expanded: pick('expanded') };
  } catch {
    return null;
  }
}

export const writeCollapsed = (value: CollapsedColumns, given?: PreferenceStorage) =>
  writePreference('collapsed', JSON.stringify(value), given);

/** Whether a column is collapsed: the person's choice, else "Out for delivery" on narrow boards. */
export function isCollapsed(
  column: BoardColumn,
  saved: CollapsedColumns | null,
  narrow: boolean,
): boolean {
  if (saved?.collapsed.includes(column)) return true;
  if (saved?.expanded.includes(column)) return false;
  return column === 'outForDelivery' && narrow;
}

export function toggleCollapsed(
  column: BoardColumn,
  saved: CollapsedColumns | null,
  narrow: boolean,
): CollapsedColumns {
  const was = isCollapsed(column, saved, narrow);
  const collapsed = (saved?.collapsed ?? []).filter((item) => item !== column);
  const expanded = (saved?.expanded ?? []).filter((item) => item !== column);
  return was
    ? { collapsed, expanded: [...expanded, column] }
    : { collapsed: [...collapsed, column], expanded };
}
