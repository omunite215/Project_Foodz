import { describe, expect, it } from 'vitest';
import {
  agoWords,
  browserFileError,
  distanceWords,
  idNumberLabel,
  keepNumberHint,
  licenseNeededLine,
  locationLine,
  missingPhotoError,
  rejectedUploadError,
  sentLine,
  stepLine,
  termsVersionLine,
  themeCookie,
  themeOf,
  tooFarNotice,
  tooManySwitches,
  uploadingLine,
  waitWords,
} from './text';

const MB = 1024 * 1024;
const NEW_YORK = 'America/New_York';

describe('the application words', () => {
  it('numbers the steps', () => {
    expect(stepLine(2)).toBe('Step 2 of 4');
  });

  it('names the number field after the document, in US spelling', () => {
    expect(idNumberLabel('DRIVER_LICENSE')).toBe('License number');
    expect(idNumberLabel('STATE_ID')).toBe('ID card number');
    expect(idNumberLabel('PASSPORT')).toBe('Passport number');
  });

  it('says a motor vehicle needs a license', () => {
    expect(licenseNeededLine('SCOOTER')).toBe("You need a driver's license to deliver by scooter.");
    expect(licenseNeededLine('CAR')).toBe("You need a driver's license to deliver by car.");
  });

  it('offers to keep the stored number when editing, showing only the last four', () => {
    expect(keepNumberHint("Driver's license", '4407')).toBe(
      "Driver's license ending 4407. Leave this empty to keep it, or type a new number.",
    );
  });

  it('dates the sending in the store time', () => {
    expect(sentLine('2026-11-19T22:40:00Z', NEW_YORK)).toBe('Sent Thu, Nov 19 · 5:40 pm');
  });

  it('shows the Terms version and date in US style', () => {
    expect(termsVersionLine(1, '2026-11-20T15:00:00Z', NEW_YORK)).toBe(
      'Version 1 · Updated Nov 20, 2026',
    );
  });
});

describe('the upload field', () => {
  it('refuses types and sizes in the browser before uploading', () => {
    expect(browserFileError({ type: 'application/pdf', size: MB }, 'photo')).toBe(
      'Only JPEG, PNG, WebP and AVIF images are accepted.',
    );
    expect(browserFileError({ type: 'image/heic', size: MB }, 'id')).toBe(
      'Only JPEG, PNG, WebP and AVIF images are accepted.',
    );
    expect(browserFileError({ type: 'image/jpeg', size: 6 * MB }, 'photo')).toBe(
      'This photo is bigger than 5 MB. Choose a smaller one.',
    );
    expect(browserFileError({ type: 'image/png', size: 12 * MB }, 'id')).toBe(
      'This photo is bigger than 10 MB. Choose a smaller one.',
    );
    expect(browserFileError({ type: 'image/webp', size: 9 * MB }, 'id')).toBeNull();
  });

  it("words the check's refusal by its code", () => {
    expect(rejectedUploadError('TOO_LARGE', 'photo')).toBe('Files for this can be at most 5 MB.');
    // A renamed file (P2.3): its name says JPEG, so "only JPEG…" would contradict it.
    expect(rejectedUploadError('BAD_TYPE', 'id')).toBe(
      'The image could not be read. Try a different file.',
    );
    expect(browserFileError({ type: 'application/pdf', size: 10 }, 'id')).toBe(
      'Only JPEG, PNG, WebP and AVIF images are accepted.',
    );
    expect(rejectedUploadError('UNREADABLE', 'id')).toBe(
      'The image could not be read. Try a different file.',
    );
    expect(rejectedUploadError('NOT_RECEIVED', 'id')).toBe(
      'The upload stopped. Check your connection and try again.',
    );
  });

  it('shows the real percent, clamped', () => {
    expect(uploadingLine(39.6)).toBe('Uploading… 40%');
    expect(uploadingLine(120)).toBe('Uploading… 100%');
  });

  it('asks for the missing photo by its document', () => {
    expect(missingPhotoError('photo', 'DRIVER_LICENSE')).toBe('Add a photo of your face.');
    expect(missingPhotoError('id', 'PASSPORT')).toBe('Add a photo of the front of your passport.');
  });
});

describe('the online screen', () => {
  it('counts seconds in steps of 10, then minutes (D24)', () => {
    expect(agoWords(3)).toBe('just now');
    expect(agoWords(27)).toBe('20 s ago');
    expect(agoWords(61)).toBe('1 min ago');
    expect(agoWords(-5)).toBe('just now');
  });

  it('words each location state with its sub line', () => {
    expect(locationLine({ kind: 'shared', secondsAgo: 20 })).toEqual({
      line: 'Location shared · 20 s ago',
      sub: null,
    });
    expect(locationLine({ kind: 'weak', secondsAgo: 20 })).toEqual({
      line: 'Weak GPS signal',
      sub: 'Location shared · 20 s ago',
    });
    expect(locationLine({ kind: 'looking', secondsAgo: 40 }).sub).toBe('Last shared 40 s ago');
    expect(locationLine({ kind: 'stale', minutes: 3 })).toEqual({
      line: 'Location not shared for 3 min',
      sub: "You won't be offered orders until it's shared again.",
    });
    expect(locationLine({ kind: 'queued', secondsAgo: 40 })).toEqual({
      line: 'Location waiting to send',
      sub: 'Last sent 40 s ago',
    });
    expect(locationLine({ kind: 'demo' }).line).toBe('Pretend location near the kitchen');
  });

  it('gives the distance to one decimal, or "At the kitchen"', () => {
    expect(distanceWords({ atKitchen: false, km: 1.2 })).toEqual({
      figure: '1.2 km',
      rest: ' from Foodz Kitchen',
    });
    expect(distanceWords({ atKitchen: true, km: 0 }).figure).toBe('At the kitchen');
  });

  it('explains the delivery range', () => {
    expect(tooFarNotice(11.5, 8)).toBe(
      "You're 11.5 km from Foodz Kitchen. Orders only go to partners within 8 km.",
    );
  });

  it('turns a wait into minutes', () => {
    expect(waitWords(30)).toBe('1 minute');
    expect(waitWords(200)).toBe('4 minutes');
    expect(tooManySwitches(240)).toBe("You've switched on and off a lot. Try again in 4 minutes.");
  });
});

describe('the theme cookie', () => {
  it('falls back to System for anything unknown', () => {
    expect(themeOf('dark')).toBe('dark');
    expect(themeOf('purple')).toBe('system');
    expect(themeOf(undefined)).toBe('system');
  });

  it('is first party, a year long and SameSite=Lax', () => {
    expect(themeCookie('light')).toBe(
      'foodz-partner-theme=light; Path=/; Max-Age=31536000; SameSite=Lax',
    );
  });
});
