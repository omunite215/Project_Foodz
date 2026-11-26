import { describe, expect, it } from 'vitest';
import { type ChimeContext, NO_COURIER_NOTES, playNoCourierChime } from '@/lib/board/sound';
import { OFFER_NOTES, OFFER_PEAK_GAIN, playOfferSound } from './offer-sound';

/* The two F7 sounds (design 1.8, 2.9): what notes they schedule, on a stand-in AudioContext. */

function fakeContext() {
  const notes: { type: string; frequency: number; start: number; stop: number; peak: number }[] =
    [];
  const context = {
    currentTime: 10,
    destination: {} as AudioNode,
    createOscillator() {
      const note = { type: '', frequency: 0, start: 0, stop: 0, peak: 0 };
      notes.push(note);
      return {
        set type(value: string) {
          note.type = value;
        },
        frequency: {
          setValueAtTime: (value: number) => {
            note.frequency = value;
          },
        },
        connect: () => undefined,
        start: (at: number) => {
          note.start = at;
        },
        stop: (at: number) => {
          note.stop = at;
        },
      } as unknown as OscillatorNode;
    },
    createGain() {
      const note = notes.at(-1);
      return {
        gain: {
          setValueAtTime: () => undefined,
          exponentialRampToValueAtTime: (value: number) => {
            if (note && value > note.peak) note.peak = value;
          },
        },
        connect: () => undefined,
      } as unknown as GainNode;
    },
  } satisfies ChimeContext;
  return { context, notes };
}

describe('the offer sound', () => {
  it('plays three rising triangle notes, brighter and louder than the board chime', () => {
    const { context, notes } = fakeContext();
    playOfferSound(context);
    expect(notes.map((note) => note.frequency)).toEqual([988, 1319, 1760]);
    expect(notes.every((note) => note.type === 'triangle')).toBe(true);
    notes.forEach((note, index) => {
      expect(note.start - 10).toBeCloseTo(OFFER_NOTES[index]?.start ?? -1);
    });
    expect(Math.max(...notes.map((note) => note.peak))).toBe(OFFER_PEAK_GAIN);
    // About 0.45 s in all.
    expect((notes.at(-1)?.stop ?? 0) - 10).toBeLessThan(0.5);
  });
});

describe('the no-courier chime', () => {
  it('falls from G5 to C5 on sine notes', () => {
    const { context, notes } = fakeContext();
    playNoCourierChime(context);
    expect(notes.map((note) => note.frequency)).toEqual(NO_COURIER_NOTES.map((n) => n.frequency));
    expect(notes[0]?.frequency).toBeGreaterThan(notes[1]?.frequency ?? 0);
    expect(notes.every((note) => note.type === 'sine')).toBe(true);
  });
});
