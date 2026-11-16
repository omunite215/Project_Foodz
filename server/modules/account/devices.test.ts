import { describe, expect, it } from 'vitest';
import { describeDevice } from './devices';

describe('describeDevice', () => {
  it.each([
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      'Safari on iPhone',
      'phone',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1',
      'Chrome on iPhone',
      'phone',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
      'Chrome on Android',
      'phone',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Safari/537.36',
      'Samsung Internet on Android',
      'tablet',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0',
      'Edge on Windows',
      'computer',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Firefox on Mac',
      'computer',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      'Safari on Mac',
      'computer',
    ],
    [
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
      'Chrome on ChromeOS',
      'computer',
    ],
  ])('names %s', (ua, label, type) => {
    expect(describeDevice(ua)).toMatchObject({ label, type });
  });

  it('falls back when nothing is known', () => {
    expect(describeDevice(null)).toEqual({
      browser: null,
      system: null,
      type: 'unknown',
      label: 'Unknown browser',
    });
    expect(describeDevice('curl/8.5.0').label).toBe('Unknown browser');
    expect(describeDevice('Mozilla/5.0 (X11; Linux x86_64)').label).toBe('Linux');
  });
});
