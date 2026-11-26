import type { UploadRejectCode } from '@/server/modules/uploads/schema';
import type { IdDocumentType } from '@/server/modules/partners/rules';
import { DOCUMENT_NOUN, dayAndTime, longDate } from '@/server/modules/partners/text';

/*
 * The partner app's own words (F6 design "Copy"): what the browser works out by itself, such as
 * upload messages, the location line and the distance. Words that depend on stored facts come
 * ready-made from the server. US spelling (lead decision).
 */

// ------------------------------------------------------------------ the application's steps

export const APPLY_STEPS = ['About you', 'Your vehicle', 'Your ID', 'Check and send'] as const;
export type ApplyStep = 1 | 2 | 3 | 4;

/** "Step 2 of 4". */
export const stepLine = (step: ApplyStep) => `Step ${step} of ${APPLY_STEPS.length}`;

export type ApplyMode = 'new' | 'reapply' | 'edit' | 'fix';

/** The plain header's title in each mode (design 2.2, 4.9). */
export const APPLY_TITLES: Record<ApplyMode, string> = {
  new: 'Apply to deliver',
  reapply: 'Apply to deliver',
  edit: 'Edit your application',
  fix: 'Fix your application',
};

export const DRAFT_KEPT = 'We kept what you entered on this phone.';
export const ID_NUMBER_NOT_KEPT =
  "For your safety we don't keep your ID number on this phone. Please type it again.";

/** "Driver's license ending 4407. Leave this empty to keep it, or type a new number." */
export const keepNumberHint = (documentWords: string, last4: string) =>
  `${documentWords} ending ${last4}. Leave this empty to keep it, or type a new number.`;

/** "License number", "ID card number", "Passport number". */
export function idNumberLabel(type: IdDocumentType): string {
  const noun = DOCUMENT_NOUN[type];
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} number`;
}

/** "As printed on your license." */
export const expiryHint = (type: IdDocumentType) => `As printed on your ${DOCUMENT_NOUN[type]}.`;

/** "You need a driver's license to deliver by scooter." */
export function licenseNeededLine(vehicle: 'SCOOTER' | 'MOTORBIKE' | 'CAR'): string {
  const by = { SCOOTER: 'scooter', MOTORBIKE: 'motorbike', CAR: 'car' }[vehicle];
  return `You need a driver's license to deliver by ${by}.`;
}

// ------------------------------------------------------------------ uploads (design 4.4)

export type UploadKind = 'photo' | 'id';

const MB = 1024 * 1024;
/** The purposes' own limits (server/modules/uploads/policy.ts). */
export const UPLOAD_LIMIT_BYTES: Record<UploadKind, number> = { photo: 5 * MB, id: 10 * MB };
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(',');

export const UPLOAD_ERRORS = {
  badType: 'Only JPEG, PNG, WebP and AVIF images are accepted.',
  unreadable: 'The image could not be read. Try a different file.',
  stopped: 'The upload stopped. Check your connection and try again.',
  unavailable: "That photo isn't available. Upload it again.",
  expired: 'Your photo from earlier has expired. Add it again.',
} as const;

const limitMb = (kind: UploadKind) => UPLOAD_LIMIT_BYTES[kind] / MB;

/** The browser's own check before uploading: type and size (design 4.4). */
export function browserFileError(
  file: { type: string; size: number },
  kind: UploadKind,
): string | null {
  if (!ACCEPTED_TYPES.some((type) => type === file.type)) return UPLOAD_ERRORS.badType;
  if (file.size > UPLOAD_LIMIT_BYTES[kind]) {
    return `This photo is bigger than ${limitMb(kind)} MB. Choose a smaller one.`;
  }
  if (file.size === 0) return UPLOAD_ERRORS.unreadable;
  return null;
}

/**
 * The check's refusal, by its code (design 4.4). The browser already accepted the file's type
 * (`browserFileError`), so a type refused by its bytes is a renamed file, like an HTML page
 * called `page.jpg`: "could not be read", not "only JPEG…", which its name contradicts (P2.3).
 */
export function rejectedUploadError(code: UploadRejectCode, kind: UploadKind): string {
  switch (code) {
    case 'TOO_LARGE':
      return `Files for this can be at most ${limitMb(kind)} MB.`;
    case 'NOT_RECEIVED':
      return UPLOAD_ERRORS.stopped;
    default:
      return UPLOAD_ERRORS.unreadable;
  }
}

/** The legend over each upload field. */
export const uploadLegend = (kind: UploadKind, type: IdDocumentType) =>
  kind === 'photo' ? 'Profile photo' : `Photo of the front of your ${DOCUMENT_NOUN[type]}`;

export const uploadHint = (kind: UploadKind) =>
  kind === 'photo'
    ? 'A clear photo of your face, without sunglasses. Customers see it during their delivery.'
    : 'Check before you send: good light, sharp text, no glare, all four corners.';

/** Read once when an upload starts. */
export const uploadingAnnouncement = (kind: UploadKind, type: IdDocumentType) =>
  kind === 'photo' ? 'Uploading your photo' : `Uploading the photo of your ${DOCUMENT_NOUN[type]}`;

export const UPLOAD_STILL_CHECKING =
  "Still checking your photo. You can carry on; we'll make sure it's ready before you send.";

/** "Uploading… 40%". */
export const uploadingLine = (percent: number) =>
  `Uploading… ${Math.max(0, Math.min(100, Math.round(percent)))}%`;

/** Missing at "Continue" or "Send". */
export const missingPhotoError = (kind: UploadKind, type: IdDocumentType) =>
  kind === 'photo'
    ? 'Add a photo of your face.'
    : `Add a photo of the front of your ${DOCUMENT_NOUN[type]}.`;

// ------------------------------------------------------------------ dates on the decision screens

/** "Sent Thu, Nov 19 · 5:40 pm". */
export const sentLine = (iso: string, timeZone: string) => `Sent ${dayAndTime(iso, timeZone)}`;

/** "Updated Fri, Nov 20 · 6:05 pm". */
export const updatedLine = (iso: string, timeZone: string) =>
  `Updated ${dayAndTime(iso, timeZone)}`;

/** "Thu, Nov 19" for an instant. */
export function shortDay(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** "Thu, Nov 19, 2026" for an instant. */
export function weekdayDateOf(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "Nov 20, 2026" for an instant. */
export function monthDayYear(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "Agreed to Partner Terms version 1 · Thu, Nov 19 · 5:40 pm". */
export const agreedLine = (version: number, iso: string, timeZone: string) =>
  `Agreed to Partner Terms version ${version} · ${dayAndTime(iso, timeZone)}`;

/** "Version 1 · Updated Nov 20, 2026" (the Terms sheet header). */
export const termsVersionLine = (version: number, publishedAt: string, timeZone: string) =>
  `Version ${version} · Updated ${monthDayYear(publishedAt, timeZone)}`;

/** The expiry note within 30 days (P4.4), from a calendar date. */
export const expiresOnWords = (date: string) => longDate(date);

// ------------------------------------------------------------------ the online screen

/** "just now" under 10 s, then seconds in steps of 10, then minutes (design 6.3, D24). */
export function agoWords(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 10) return 'just now';
  if (s < 60) return `${Math.floor(s / 10) * 10} s ago`;
  return `${Math.floor(s / 60)} min ago`;
}

export type LocationLineState =
  | { kind: 'shared'; secondsAgo: number }
  | { kind: 'weak'; secondsAgo: number }
  | { kind: 'looking'; secondsAgo: number | null }
  | { kind: 'stale'; minutes: number }
  | { kind: 'queued'; secondsAgo: number | null }
  | { kind: 'demo' };

/**
 * The location line and its sub line (design 6.3's table). While he holds an order (F8 review
 * S8), the stale line says who can't see him, not what happens to offers.
 */
export function locationLine(
  state: LocationLineState,
  holding: { afterPickup: boolean; customerFirst: string | null } | null = null,
): { line: string; sub: string | null } {
  switch (state.kind) {
    case 'shared':
      return { line: `Location shared · ${agoWords(state.secondsAgo)}`, sub: null };
    case 'weak':
      return { line: 'Weak GPS signal', sub: `Location shared · ${agoWords(state.secondsAgo)}` };
    case 'looking':
      return {
        line: 'Looking for GPS…',
        sub: state.secondsAgo === null ? null : `Last shared ${agoWords(state.secondsAgo)}`,
      };
    case 'stale':
      return {
        line: `Location not shared for ${Math.max(2, state.minutes)} min`,
        sub: holding
          ? `${holding.afterPickup && holding.customerFirst ? holding.customerFirst : 'Foodz'} can't see you coming.`
          : "You won't be offered orders until it's shared again.",
      };
    case 'queued':
      return {
        line: 'Location waiting to send',
        sub: state.secondsAgo === null ? null : `Last sent ${agoWords(state.secondsAgo)}`,
      };
    default:
      return { line: 'Pretend location near the kitchen', sub: 'Not your real location' };
  }
}

/** "1.2 km" with "from Foodz Kitchen", or "At the kitchen" (design 6.3). */
export function distanceWords(distance: { atKitchen: boolean; km: number }): {
  figure: string;
  rest: string;
} {
  if (distance.atKitchen) return { figure: 'At the kitchen', rest: '' };
  return { figure: `${distance.km.toFixed(1)} km`, rest: ' from Foodz Kitchen' };
}

/** P10.4: "You're 11.5 km from Foodz Kitchen. Orders only go to partners within 8 km." */
export const tooFarNotice = (km: number, radiusKm: number) =>
  `You're ${km.toFixed(1)} km from Foodz Kitchen. Orders only go to partners within ${radiusKm} km.`;

/** P10.7: "Your location wasn't shared for 4 min while Foodz was in the background." */
export const backgroundNotice = (minutes: number) =>
  `Your location wasn't shared for ${Math.max(1, Math.round(minutes))} min while Foodz was in the background.`;

/** "4 minutes", "1 minute": a wait from `Retry-After`. */
export function waitWords(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

export const tooManySwitches = (seconds: number) =>
  `You've switched on and off a lot. Try again in ${waitWords(seconds)}.`;

/** "Battery 14%. Plug in to stay online." */
export const batteryLine = (level: number) =>
  `Battery ${Math.round(level * 100)}%. Plug in to stay online.`;

/** "Online since 6:00 pm". */
export const onlineSinceLine = (clock: string) => `Online since ${clock}`;

export const PARTNER_COPY = {
  online: "You're online. Sharing your location.",
  offline: "You're offline. Location sharing stopped.",
  needConnection: 'You need a connection to go online.',
  couldNotGoOnline: "We couldn't take you online. Try again.",
  finding: 'Finding your location…',
  otherDevice: 'You went online on another device, so sharing stopped here.',
  resumed: "You're still online. Sharing your location again.",
  noConnection: "No connection. You're still online. We'll send your location when you're back.",
  backOnline: 'Back online. Location sent.',
  offlineOnPhone:
    "You're offline on this phone. We'll tell Foodz when you're back on a connection.",
  screenUnsupported: 'Set your screen to stay on while you deliver.',
  screenRefused: "Your phone didn't keep the screen on. Check Low Power Mode.",
  demoBanner:
    'Demo partner: we use a pretend location near the kitchen, never your real one. Other visitors share this account, so its online state is shared too.',
  demoOffline: 'Another visitor took the demo partner offline.',
  newVersion: 'A new version of the app is ready.',
} as const;

// ------------------------------------------------------------------ the theme (design 2.5)

export const THEME_COOKIE = 'foodz-partner-theme';
export const PARTNER_THEMES = ['system', 'light', 'dark'] as const;
export type PartnerTheme = (typeof PARTNER_THEMES)[number];

const isTheme = (value: string | undefined): value is PartnerTheme =>
  PARTNER_THEMES.some((theme) => theme === value);

export const themeOf = (value: string | undefined): PartnerTheme =>
  isTheme(value) ? value : 'system';

/** One year, first-party, readable by the page, `SameSite=Lax`. */
export const themeCookie = (theme: PartnerTheme) =>
  `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;

/** The top bar's colour for `<meta name="theme-color">` (design 2.5). */
export const THEME_COLORS = {
  plain: { light: '#fcfcfd', dark: '#141416' },
  online: { light: '#02630a', dark: '#03850a' },
  offline: { light: '#23262f', dark: '#23262f' },
} as const;
