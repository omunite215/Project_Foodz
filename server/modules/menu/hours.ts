import type { OpeningHours, StoreMoment, StoreStatus, Weekday } from './schema';

/*
 * Whether the store is open at an instant, worked out in the store's own time zone.
 * No server imports: the browser uses storeStatusAt() to keep a status current.
 *
 * Opening hours are wall-clock times ("11:00" to "22:00" on Mondays). Each day's range is
 * turned into a pair of UTC instants for that calendar date in the store's zone, so daylight
 * saving changes fall out of the time zone data instead of fixed offsets. A closing time at or
 * before the opening time ends on the next day.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// Date#getUTCDay order.
const WEEKDAY_BY_INDEX: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface OpenState {
  isOpen: boolean;
  /** When open: the end of the current opening. Null when open around the clock. */
  closesAt: StoreMoment | null;
  /** When closed: the next opening within a week. Null when there is none. */
  opensAt: StoreMoment | null;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    return Boolean(new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

/** The openings from yesterday to a week ahead, as UTC instants. */
function openingsAround(hours: OpeningHours, timeZone: string, today: number) {
  // Yesterday is included because its opening may run past midnight into today.
  const ranges: [number, number][] = [];
  for (let offset = -1; offset <= 7; offset++) {
    const date = today + offset * DAY_MS;
    const day = hours[weekdayOf(date)];
    if (!day) continue;
    const open = minutesOf(day.open);
    const close = minutesOf(day.close);
    const start = zonedTimeToUtc(date, open, timeZone);
    const end = zonedTimeToUtc(close <= open ? date + DAY_MS : date, close, timeZone);
    if (end > start) ranges.push([start, end]);
  }
  return ranges;
}

export function openState(hours: OpeningHours, timeZone: string, at: Date): OpenState {
  const now = at.getTime();
  const today = calendarDateOf(now, timeZone);
  const ranges = openingsAround(hours, timeZone, today);

  const current = merge(ranges).find(([start, end]) => start <= now && now < end);
  if (current) {
    // A range that runs a whole week without a break is "open around the clock".
    const roundTheClock = current[1] - now >= 7 * DAY_MS;
    return {
      isOpen: true,
      closesAt: roundTheClock ? null : moment(current[1], today, timeZone),
      opensAt: null,
    };
  }

  const next = ranges.map(([start]) => start).filter((start) => start > now);
  return {
    isOpen: false,
    closesAt: null,
    opensAt: next.length > 0 ? moment(Math.min(...next), today, timeZone) : null,
  };
}

/**
 * When the store last closed, while it is closed: "We closed at 10 pm while you were checking
 * out" (F4 S3.5). Null while open, or when it has not been open since yesterday.
 */
export function lastClosing(hours: OpeningHours, timeZone: string, at: Date): StoreMoment | null {
  const now = at.getTime();
  const today = calendarDateOf(now, timeZone);
  const merged = merge(openingsAround(hours, timeZone, today));
  if (merged.some(([start, end]) => start <= now && now < end)) return null;
  const ends = merged.map(([, end]) => end).filter((end) => end <= now);
  return ends.length > 0 ? moment(Math.max(...ends), today, timeZone) : null;
}

/** The store's weekday at an instant. */
export function weekdayAt(at: Date, timeZone: string): Weekday {
  return weekdayOf(calendarDateOf(at.getTime(), timeZone));
}

/**
 * The same status, re-evaluated at another instant from its own weekly hours. The page gets a
 * status from the server and calls this on a timer, so "Open now" turns into "Closed" on time
 * without another request.
 */
export function storeStatusAt(status: StoreStatus, at: Date): StoreStatus {
  const hours: OpeningHours = {};
  for (const day of status.weeklyHours) hours[day.weekday] = day.hours;
  return {
    ...status,
    at: at.toISOString(),
    today: weekdayAt(at, status.timeZone),
    ...openState(hours, status.timeZone, at),
  };
}

function merge(ranges: [number, number][]) {
  const merged: [number, number][] = [];
  for (const [start, end] of ranges.toSorted((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function moment(instant: number, today: number, timeZone: string): StoreMoment {
  const local = localParts(instant, timeZone);
  const date = Date.UTC(local.year, local.month - 1, local.day);
  const days = Math.round((date - today) / DAY_MS);
  return {
    at: new Date(instant).toISOString(),
    weekday: weekdayOf(date),
    time: `${pad(local.hour)}:${pad(local.minute)}`,
    day: days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'later',
  };
}

// ------------------------------------------------------------------ time zone arithmetic

/** A calendar date is represented by UTC midnight of that date, so day steps are exact. */
function calendarDateOf(instant: number, timeZone: string) {
  const local = localParts(instant, timeZone);
  return Date.UTC(local.year, local.month - 1, local.day);
}

function weekdayOf(date: number): Weekday {
  return WEEKDAY_BY_INDEX[new Date(date).getUTCDay()] ?? 'sun';
}

function minutesOf(clock: string) {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number);
  return hours * 60 + minutes;
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * The instant a wall-clock time happens on a date in a zone. A time skipped when clocks go
 * forward moves forward by the jump (02:30 becomes 03:30); a time that happens twice when
 * clocks go back resolves to the first occurrence.
 */
function zonedTimeToUtc(date: number, minutes: number, timeZone: string) {
  const wallClock = date + minutes * MINUTE_MS;
  const firstGuess = offsetMinutes(wallClock, timeZone);
  let instant = wallClock - firstGuess * MINUTE_MS;
  const second = offsetMinutes(instant, timeZone);
  if (second === firstGuess) return instant;

  instant = wallClock - second * MINUTE_MS;
  const third = offsetMinutes(instant, timeZone);
  if (third === second) return instant;

  // The wall-clock time does not exist: use the offset from before the jump.
  return wallClock - Math.min(second, third) * MINUTE_MS;
}

/** How far the zone's clocks are ahead of UTC at an instant, in minutes (New York in winter: -300). */
function offsetMinutes(instant: number, timeZone: string) {
  const local = localParts(instant, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return Math.round((asUtc - instant) / MINUTE_MS);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function localParts(instant: number, timeZone: string) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, format);
  }
  const parts = format.formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}
