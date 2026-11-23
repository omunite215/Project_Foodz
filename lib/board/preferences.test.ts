import { describe, expect, it } from 'vitest';
import {
  isCollapsed,
  type PreferenceStorage,
  readCollapsed,
  readSwitch,
  toggleCollapsed,
  writeCollapsed,
  writeSwitch,
} from './preferences';
import { soundStateAfterLoad, playChime, CHIME_NOTES, type ChimeContext } from './sound';
import { msUntil, serverNow, serverOffset } from './clock';

function memory(): PreferenceStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const broken: PreferenceStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('device preferences', () => {
  it('remembers switches, and knows when nothing was chosen', () => {
    const storage = memory();
    expect(readSwitch('sound', storage)).toBeNull();
    writeSwitch('sound', true, storage);
    expect(readSwitch('sound', storage)).toBe(true);
    writeSwitch('wakeLock', false, storage);
    expect(readSwitch('wakeLock', storage)).toBe(false);
  });

  it('works without storage', () => {
    expect(readSwitch('sound', broken)).toBeNull();
    expect(() => writeSwitch('sound', true, broken)).not.toThrow();
  });

  it('collapses Out for delivery on narrow boards until someone opens it (design 2.1)', () => {
    expect(isCollapsed('outForDelivery', null, true)).toBe(true);
    expect(isCollapsed('outForDelivery', null, false)).toBe(false);
    const opened = toggleCollapsed('outForDelivery', null, true);
    expect(isCollapsed('outForDelivery', opened, true)).toBe(false);
    const closed = toggleCollapsed('new', opened, true);
    expect(isCollapsed('new', closed, true)).toBe(true);
  });

  it('reads back only real columns', () => {
    const storage = memory();
    writeCollapsed({ collapsed: ['new'], expanded: ['outForDelivery'] }, storage);
    expect(readCollapsed(storage)).toEqual({ collapsed: ['new'], expanded: ['outForDelivery'] });
    storage.setItem('foodz.board.collapsed', '{"collapsed":["kitchen-sink"]}');
    expect(readCollapsed(storage)).toEqual({ collapsed: [], expanded: [] });
    storage.setItem('foodz.board.collapsed', 'not json');
    expect(readCollapsed(storage)).toBeNull();
  });
});

const param = () => ({
  setValueAtTime: () => undefined,
  exponentialRampToValueAtTime: () => undefined,
});

describe('sound (design 2.10)', () => {
  it('stays silent after a reload until the browser allows sound (A3.4)', () => {
    expect(soundStateAfterLoad(null, null)).toBe('off');
    expect(soundStateAfterLoad(false, 'running')).toBe('off');
    expect(soundStateAfterLoad(true, 'suspended')).toBe('blocked');
    expect(soundStateAfterLoad(true, 'running')).toBe('on');
  });

  it('plays two sine notes, 660 then 880 Hz', () => {
    const started: { frequency: number; at: number }[] = [];
    const context = {
      currentTime: 1,
      destination: {},
      createOscillator: () => {
        let frequency = 0;
        return {
          type: 'square',
          frequency: { ...param(), setValueAtTime: (value: number) => (frequency = value) },
          connect: () => undefined,
          start: (time: number) => started.push({ frequency, at: time }),
          stop: () => undefined,
        };
      },
      createGain: () => ({ gain: param(), connect: () => undefined }),
    } as unknown as ChimeContext;
    playChime(context);
    expect(started).toEqual(
      CHIME_NOTES.map((note) => ({ frequency: note.frequency, at: 1 + note.start })),
    );
  });
});

describe('the server clock (B14)', () => {
  it('counts from the snapshot, not the device', () => {
    const offset = serverOffset('2026-11-21T00:30:00.000Z', Date.parse('2026-11-21T00:29:00.000Z'));
    expect(offset).toBe(60_000);
    expect(serverNow(offset, Date.parse('2026-11-21T00:29:30.000Z')).toISOString()).toBe(
      '2026-11-21T00:30:30.000Z',
    );
    expect(
      msUntil('2026-11-21T00:30:10.000Z', offset, Date.parse('2026-11-21T00:29:00.000Z')),
    ).toBe(10_000);
  });
});
