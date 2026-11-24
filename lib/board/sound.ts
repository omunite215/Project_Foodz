/*
 * The board's chime (F5 design 2.10, D11): two soft sine notes, 660 Hz then 880 Hz, 180 ms each,
 * 10 ms attack, exponential release, peak gain 0.25. Generated with the Web Audio API, so there
 * is no file, licence or media-src. Browsers play sound only after a tap, so a sound left on
 * before a reload shows "Tap to turn sound back on" until someone taps.
 */

export type SoundState = 'off' | 'on' | 'blocked';

export const CHIME_NOTES = [
  { frequency: 660, start: 0 },
  { frequency: 880, start: 0.2 },
] as const;
export const CHIME_NOTE_SECONDS = 0.18;
export const CHIME_ATTACK_SECONDS = 0.01;
export const CHIME_PEAK_GAIN = 0.25;
/** The chime repeats this often while an order has waited over 2 minutes (A3.3). */
export const CHIME_REPEAT_MS = 60_000;

/** What the button shows after a reload: a saved "on" stays silent until the browser allows it. */
export function soundStateAfterLoad(
  saved: boolean | null,
  context: AudioContextState | null,
): SoundState {
  if (!saved) return 'off';
  return context === 'running' ? 'on' : 'blocked';
}

/** The minimal Web Audio surface the chime needs, so tests can pass a stand-in. */
export interface ChimeContext {
  currentTime: number;
  destination: AudioNode;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
}

export function playChime(context: ChimeContext): void {
  for (const note of CHIME_NOTES) {
    const start = context.currentTime + note.start;
    const end = start + CHIME_NOTE_SECONDS;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(note.frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(CHIME_PEAK_GAIN, start + CHIME_ATTACK_SECONDS);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }
}

/** One AudioContext per tab, made on the first tap (or on load, to learn whether it may play). */
let shared: AudioContext | null = null;

export function audioContext(): AudioContext | null {
  if (shared) return shared;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null;
  try {
    shared = new window.AudioContext();
  } catch {
    return null;
  }
  return shared;
}

/*
 * The no-courier chime (F7 design 2.9, A39.1, D25): two sine notes falling, G5 then C5, 220 ms
 * each, 30 ms apart, peak gain 0.3. A recognizably different "something's wrong" against the
 * rising new-order chime. Once when an order escalates, then every 2 minutes while any order
 * has no courier, only when the board's sound is on.
 */
export const NO_COURIER_NOTES = [
  { frequency: 784, start: 0 },
  { frequency: 523, start: 0.25 },
] as const;
export const NO_COURIER_NOTE_SECONDS = 0.22;
export const NO_COURIER_PEAK_GAIN = 0.3;
export const NO_COURIER_REPEAT_MS = 120_000;

export function playNoCourierChime(context: ChimeContext): void {
  for (const note of NO_COURIER_NOTES) {
    const start = context.currentTime + note.start;
    const end = start + NO_COURIER_NOTE_SECONDS;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(note.frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(NO_COURIER_PEAK_GAIN, start + CHIME_ATTACK_SECONDS);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }
}
