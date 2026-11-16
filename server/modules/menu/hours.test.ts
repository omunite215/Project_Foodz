import { describe, expect, it } from 'vitest';
import { isValidTimeZone, openState, storeStatusAt, weekdayAt } from './hours';
import type { OpeningHours, StoreStatus } from './schema';

const NEW_YORK = 'America/New_York';

// The seeded store hours.
const hours: OpeningHours = {
  mon: { open: '11:00', close: '22:00' },
  tue: { open: '11:00', close: '22:00' },
  wed: { open: '11:00', close: '22:00' },
  thu: { open: '11:00', close: '22:00' },
  fri: { open: '11:00', close: '23:00' },
  sat: { open: '12:00', close: '23:00' },
  sun: { open: '12:00', close: '21:00' },
};

const at = (iso: string) => new Date(iso);

describe('openState: the seeded hours in Boston (November 2026, EST = UTC-5)', () => {
  it.each([
    // [label, instant, closing time]
    ['Sunday 20:59', '2026-11-16T01:59:00Z', { at: '2026-11-16T02:00:00.000Z', time: '21:00' }],
    ['Friday 22:30', '2026-11-14T03:30:00Z', { at: '2026-11-14T04:00:00.000Z', time: '23:00' }],
    ['Monday 11:00', '2026-11-16T16:00:00Z', { at: '2026-11-17T03:00:00.000Z', time: '22:00' }],
    ['Monday 21:59', '2026-11-17T02:59:00Z', { at: '2026-11-17T03:00:00.000Z', time: '22:00' }],
  ])('%s is open until the closing time, today', (_, instant, closes) => {
    const state = openState(hours, NEW_YORK, at(instant));
    expect(state.isOpen).toBe(true);
    expect(state.opensAt).toBeNull();
    expect(state.closesAt).toMatchObject({ ...closes, day: 'today' });
  });

  it.each([
    // [label, instant, next opening]
    [
      'Sunday 21:00',
      '2026-11-16T02:00:00Z',
      { at: '2026-11-16T16:00:00.000Z', weekday: 'mon', time: '11:00', day: 'tomorrow' },
    ],
    [
      'Saturday 11:30',
      '2026-11-14T16:30:00Z',
      { at: '2026-11-14T17:00:00.000Z', weekday: 'sat', time: '12:00', day: 'today' },
    ],
    [
      'Monday 10:59',
      '2026-11-16T15:59:00Z',
      { at: '2026-11-16T16:00:00.000Z', weekday: 'mon', time: '11:00', day: 'today' },
    ],
    [
      'Monday 22:00',
      '2026-11-17T03:00:00Z',
      { at: '2026-11-17T16:00:00.000Z', weekday: 'tue', time: '11:00', day: 'tomorrow' },
    ],
    [
      'Saturday 23:00',
      '2026-11-15T04:00:00Z',
      { at: '2026-11-15T17:00:00.000Z', weekday: 'sun', time: '12:00', day: 'tomorrow' },
    ],
    [
      'Sunday 00:30, after midnight',
      '2026-11-15T05:30:00Z',
      { at: '2026-11-15T17:00:00.000Z', weekday: 'sun', time: '12:00', day: 'today' },
    ],
  ])('%s is closed and names the next opening', (_, instant, opens) => {
    const state = openState(hours, NEW_YORK, at(instant));
    expect(state.isOpen).toBe(false);
    expect(state.closesAt).toBeNull();
    expect(state.opensAt).toEqual(opens);
  });
});

describe('openState across daylight saving changes', () => {
  it('opens at noon local time on the day clocks go forward (8 March 2026)', () => {
    // Saturday 23:00 EST. Noon on Sunday is EDT (UTC-4), 12 hours later, not 13.
    const saturdayNight = openState(hours, NEW_YORK, at('2026-03-08T04:00:00Z'));
    expect(saturdayNight.opensAt).toMatchObject({ at: '2026-03-08T16:00:00.000Z', time: '12:00' });

    expect(openState(hours, NEW_YORK, at('2026-03-08T15:59:00Z')).isOpen).toBe(false);
    const noon = openState(hours, NEW_YORK, at('2026-03-08T16:00:00Z'));
    expect(noon.isOpen).toBe(true);
    expect(noon.closesAt).toMatchObject({ at: '2026-03-09T01:00:00.000Z', time: '21:00' });
  });

  it('opens at noon local time on the day clocks go back (1 November 2026)', () => {
    const saturdayNight = openState(hours, NEW_YORK, at('2026-11-01T03:00:00Z'));
    expect(saturdayNight.isOpen).toBe(false);
    expect(saturdayNight.opensAt).toMatchObject({ at: '2026-11-01T17:00:00.000Z', time: '12:00' });

    expect(openState(hours, NEW_YORK, at('2026-11-01T16:59:00Z')).isOpen).toBe(false);
    const noon = openState(hours, NEW_YORK, at('2026-11-01T17:00:00Z'));
    expect(noon.closesAt).toMatchObject({ at: '2026-11-02T02:00:00.000Z', time: '21:00' });
  });

  it('closes after midnight at the right instant when the clocks go forward overnight', () => {
    const late: OpeningHours = { sat: { open: '22:00', close: '03:00' } };
    // 01:59 EST, then the clock jumps to 03:00 EDT: four real hours after opening.
    const beforeJump = openState(late, NEW_YORK, at('2026-03-08T06:59:00Z'));
    expect(beforeJump.isOpen).toBe(true);
    expect(beforeJump.closesAt).toMatchObject({
      at: '2026-03-08T07:00:00.000Z',
      weekday: 'sun',
      time: '03:00',
      day: 'today',
    });
    expect(openState(late, NEW_YORK, at('2026-03-08T07:00:00Z')).isOpen).toBe(false);
  });

  it('stays open through the repeated hour when the clocks go back overnight', () => {
    const late: OpeningHours = { sat: { open: '22:00', close: '02:00' } };
    // 01:30 EST, the second time 01:30 happens that night.
    expect(openState(late, NEW_YORK, at('2026-11-01T06:30:00Z')).isOpen).toBe(true);
    expect(openState(late, NEW_YORK, at('2026-11-01T07:00:00Z')).isOpen).toBe(false);
  });

  it('moves an opening time that does not exist to just after the jump', () => {
    const early: OpeningHours = { sun: { open: '02:30', close: '10:00' } };
    const state = openState(early, NEW_YORK, at('2026-03-08T05:00:00Z'));
    expect(state.opensAt).toMatchObject({ at: '2026-03-08T07:30:00.000Z', time: '03:30' });
  });
});

describe('openState with other schedules', () => {
  it('handles hours that run past midnight', () => {
    const night: OpeningHours = { fri: { open: '18:00', close: '02:00' } };
    // Saturday 01:30 EST, still Friday's opening.
    const open = openState(night, NEW_YORK, at('2026-11-14T06:30:00Z'));
    expect(open.isOpen).toBe(true);
    expect(open.closesAt).toMatchObject({ weekday: 'sat', time: '02:00', day: 'today' });

    const closed = openState(night, NEW_YORK, at('2026-11-14T07:00:00Z'));
    expect(closed.isOpen).toBe(false);
    expect(closed.opensAt).toMatchObject({
      at: '2026-11-20T23:00:00.000Z',
      weekday: 'fri',
      time: '18:00',
      day: 'later',
    });
  });

  it('joins an opening that ends at midnight with one that starts there', () => {
    const joined: OpeningHours = {
      mon: { open: '18:00', close: '00:00' },
      tue: { open: '00:00', close: '02:00' },
    };
    const state = openState(joined, NEW_YORK, at('2026-11-17T04:59:00Z'));
    expect(state.closesAt).toMatchObject({ weekday: 'tue', time: '02:00', day: 'tomorrow' });
  });

  it('reports no closing time when open around the clock', () => {
    const always: OpeningHours = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [
        day,
        { open: '00:00', close: '00:00' },
      ]),
    );
    const state = openState(always, NEW_YORK, at('2026-11-15T12:00:00Z'));
    expect(state).toEqual({ isOpen: true, closesAt: null, opensAt: null });
  });

  it('reports no opening time when no hours are set', () => {
    expect(openState({}, NEW_YORK, at('2026-11-15T12:00:00Z'))).toEqual({
      isOpen: false,
      closesAt: null,
      opensAt: null,
    });
  });

  it('uses the store time zone, whatever the server or device is set to', () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Tokyo';
      const state = openState(hours, NEW_YORK, at('2026-11-16T01:59:00Z'));
      expect(state.closesAt).toMatchObject({ weekday: 'sun', time: '21:00' });
    } finally {
      process.env.TZ = previous;
    }
  });

  it('works in a zone ahead of UTC', () => {
    // 09:00 on Monday in Tokyo is 00:00 UTC.
    const state = openState(hours, 'Asia/Tokyo', at('2026-11-16T00:00:00Z'));
    expect(state.opensAt).toEqual({
      at: '2026-11-16T02:00:00.000Z',
      weekday: 'mon',
      time: '11:00',
      day: 'today',
    });
  });
});

describe('storeStatusAt: re-evaluating a status on the client', () => {
  // As the server sends it on Sunday at 20:59 in Boston.
  const sundayEvening: StoreStatus = {
    timeZone: NEW_YORK,
    at: '2026-11-16T01:59:00.000Z',
    today: 'sun',
    isOpen: true,
    closesAt: { at: '2026-11-16T02:00:00.000Z', weekday: 'sun', time: '21:00', day: 'today' },
    opensAt: null,
    weeklyHours: (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((weekday) => ({
      weekday,
      hours: hours[weekday] ?? null,
    })),
    store: { name: 'Foodz', addressText: '88 Harbor Street', phone: '+1', email: 'a@b.c' },
    footerLinks: [],
    delivery: { promiseMinutes: 45, radiusKm: 8, baseFeeCents: 199, perKmFeeCents: 50 },
  };

  it('turns "open" into "closed" once the closing time passes, keeping everything else', () => {
    const later = storeStatusAt(sundayEvening, at('2026-11-16T02:00:30Z'));
    expect(later).toEqual({
      ...sundayEvening,
      at: '2026-11-16T02:00:30.000Z',
      isOpen: false,
      closesAt: null,
      opensAt: { at: '2026-11-16T16:00:00.000Z', weekday: 'mon', time: '11:00', day: 'tomorrow' },
    });
  });

  it('moves "today" past midnight in the store time zone', () => {
    expect(storeStatusAt(sundayEvening, at('2026-11-16T05:00:00Z')).today).toBe('mon');
    expect(weekdayAt(at('2026-11-16T04:59:00Z'), NEW_YORK)).toBe('sun');
  });
});

describe('isValidTimeZone', () => {
  it.each(['America/New_York', 'Asia/Tokyo', 'UTC'])('accepts %s', (zone) => {
    expect(isValidTimeZone(zone)).toBe(true);
  });

  it.each(['Boston', '', 'America/Nowhere', '+05:00x'])('rejects %j', (zone) => {
    expect(isValidTimeZone(zone)).toBe(false);
  });
});
