/**
 * A short, human name for a signed-in device from its user agent: "Safari on iPhone". Only the
 * browser family and system are kept; versions and everything else are dropped.
 */

export type DeviceType = 'phone' | 'tablet' | 'computer' | 'unknown';

export interface DeviceName {
  browser: string | null;
  system: string | null;
  type: DeviceType;
  label: string;
}

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
  [/\bSafari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string, DeviceType][] = [
  [/\biPhone\b/, 'iPhone', 'phone'],
  [/\biPad\b/, 'iPad', 'tablet'],
  [/\bAndroid\b.*\bMobile\b/, 'Android', 'phone'],
  [/\bAndroid\b/, 'Android', 'tablet'],
  [/\bCrOS\b/, 'ChromeOS', 'computer'],
  [/\bWindows\b/, 'Windows', 'computer'],
  [/\bMacintosh\b|\bMac OS X\b/, 'Mac', 'computer'],
  [/\bLinux\b/, 'Linux', 'computer'],
];

export function describeDevice(userAgent: string | null | undefined): DeviceName {
  const ua = (userAgent ?? '').slice(0, 512);
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua));
  // iPadOS asks for desktop sites and reports a Mac; touch support is not visible here.
  const label =
    browser && system
      ? `${browser} on ${system[1]}`
      : (browser ?? system?.[1] ?? 'Unknown browser');
  return { browser, system: system?.[1] ?? null, type: system?.[2] ?? 'unknown', label };
}
