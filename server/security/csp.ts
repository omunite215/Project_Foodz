/**
 * Content Security Policy. Scripts must carry the per-request nonce; `strict-dynamic` lets those
 * scripts load their own dependencies. Every third-party origin the app talks to is listed here,
 * and nowhere else.
 */

export interface CspOptions {
  nonce: string;
  isDev: boolean;
  /** Only HTTPS deployments ask browsers to upgrade insecure requests. */
  isHttps?: boolean;
  /** Public bucket URL for uploaded images (R2 in production, RustFS locally). */
  imageOrigins?: string[];
  /**
   * Where the browser talks to object storage directly: signed uploads (fetch PUT) and signed
   * downloads (images). See `storageOrigins`.
   */
  storageOrigins?: string[];
  /** Realtime (Pusher/Soketi) socket origins. */
  socketOrigins?: string[];
  reportUri?: string;
}

// Stripe.js and its card and bank-check frames (F4 B19). Stripe serves parts of Stripe.js from
// subdomains of js.stripe.com. Browsers that honour 'strict-dynamic' ignore host sources in
// script-src; older ones fall back to them.
const STRIPE_SCRIPTS = ['https://js.stripe.com', 'https://*.js.stripe.com'];
const STRIPE_FRAMES = [
  'https://js.stripe.com',
  'https://*.js.stripe.com',
  'https://hooks.stripe.com',
];
const TURNSTILE = 'https://challenges.cloudflare.com';
const MAP_TILES = 'https://tiles.openfreemap.org';
const SENTRY = 'https://*.ingest.sentry.io';

export function buildCsp(options: CspOptions): string {
  const { nonce, isDev, imageOrigins = [], socketOrigins = [] } = options;
  const storage = options.storageOrigins ?? [];

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...STRIPE_SCRIPTS,
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // Components set inline style attributes (positioning, animation); scripts stay nonce-only.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', MAP_TILES, ...imageOrigins, ...storage],
    'font-src': ["'self'"],
    'connect-src': [
      "'self'",
      'https://api.stripe.com',
      MAP_TILES,
      TURNSTILE,
      SENTRY,
      ...storage,
      ...socketOrigins,
      ...(isDev ? ['ws:'] : []),
    ],
    'frame-src': [...STRIPE_FRAMES, TURNSTILE],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'media-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };

  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`);
  if (!isDev && options.isHttps) parts.push('upgrade-insecure-requests');
  if (options.reportUri) parts.push(`report-uri ${options.reportUri}`);
  return parts.join('; ');
}

/** Geolocation is only offered where it is needed: the partner app and checkout. */
export function permissionsPolicy(pathname: string): string {
  const needsLocation = pathname.startsWith('/partner') || pathname.startsWith('/checkout');
  return [
    `geolocation=(${needsLocation ? 'self' : ''})`,
    'camera=()',
    'microphone=()',
    'usb=()',
    'interest-cohort=()',
    'payment=(self "https://js.stripe.com")',
  ].join(', ');
}

export function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * The origins the browser uses for signed uploads and downloads. With `S3_ENDPOINT` set (RustFS
 * locally, any S3-compatible store) that is the endpoint's origin; on AWS there is no endpoint
 * and signed links point at each bucket's regional virtual-hosted address.
 */
export function storageOrigins(env: Record<string, string | undefined>): string[] {
  const endpoint = originOf(env.S3_ENDPOINT);
  if (endpoint) return [endpoint];
  const region = env.S3_REGION;
  if (!region || region === 'auto') return [];
  return [env.S3_PRIVATE_BUCKET, env.S3_PUBLIC_BUCKET]
    .filter((bucket): bucket is string => Boolean(bucket))
    .map((bucket) => `https://${bucket}.s3.${region}.amazonaws.com`);
}
