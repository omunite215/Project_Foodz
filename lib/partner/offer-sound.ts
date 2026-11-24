import { audioContext, type ChimeContext } from '@/lib/board/sound';

/*
 * The offer sound (F7 design 1.8, lead decision 1): three rising triangle notes, B5, E6 and A6,
 * 110 ms each with a 5 ms attack and an exponential release, 40 ms apart, peak gain 0.6. About
 * 0.45 s: higher, brighter and louder than the board's soft chime, so it carries over street
 * noise. Generated with the Web Audio API, so there is no file, license or media-src. It plays
 * when an offer opens and every 3 s until a control is touched or the offer ends; phones that
 * let web apps vibrate buzz with it.
 */

export const OFFER_NOTES = [
  { frequency: 988, start: 0 },
  { frequency: 1319, start: 0.15 },
  { frequency: 1760, start: 0.3 },
] as const;
export const OFFER_NOTE_SECONDS = 0.11;
export const OFFER_ATTACK_SECONDS = 0.005;
export const OFFER_PEAK_GAIN = 0.6;
export const OFFER_REPEAT_MS = 3_000;
export const OFFER_VIBRATION = [300, 150, 300] as const;
/** P31: one short buzz when his order changes under him. */
export const CHANGE_VIBRATION = 200;

export function playOfferSound(context: ChimeContext): void {
  for (const note of OFFER_NOTES) {
    const start = context.currentTime + note.start;
    const end = start + OFFER_NOTE_SECONDS;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(note.frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(OFFER_PEAK_GAIN, start + OFFER_ATTACK_SECONDS);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }
}

/** Where the phone lets web apps vibrate at all (Chrome on Android; never iPhone). */
export const canVibrate = () =>
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

export function vibrate(pattern: number | readonly number[]): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(typeof pattern === 'number' ? pattern : [...pattern]);
  } catch {
    // Refused (no user gesture yet): the sound and the flash still carry it.
  }
}

/** Safari's audio session: play at media volume on iPhone. Elsewhere nothing to set. */
function preferMediaVolume() {
  const session: unknown =
    typeof navigator === 'undefined' ? null : Reflect.get(navigator, 'audioSession');
  if (typeof session !== 'object' || session === null) return;
  try {
    Reflect.set(session, 'type', 'playback');
  } catch {
    // Read-only in this browser.
  }
}

/** Whether the offer sound can play right now without a tap. */
export function offerSoundReady(): boolean {
  return audioContext()?.state === 'running';
}

/**
 * Inside a tap ("Go online", the sound banner, "Test offer alert"): creates or resumes the
 * shared AudioContext so later offers can play without one (P19.4). Plays nothing.
 */
export async function unlockOfferSound(): Promise<boolean> {
  preferMediaVolume();
  const context = audioContext();
  if (!context) return false;
  try {
    await context.resume();
  } catch {
    return false;
  }
  return context.state === 'running';
}

/** One alert: the sound where it may play, and the buzz where the phone allows it. */
export function alertOnce(): void {
  const context = audioContext();
  if (context?.state === 'running') playOfferSound(context);
  vibrate(OFFER_VIBRATION);
}
