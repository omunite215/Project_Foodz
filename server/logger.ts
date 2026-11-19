import 'server-only';
import pino from 'pino';

/**
 * Fields that never reach a log line: credentials, links that sign someone in, contact details,
 * home addresses and positions. Redaction matches exact keys, so each is listed at the top level
 * and one level down (`{ input: { … } }`, `{ user: { … } }`).
 */
const SENSITIVE_KEYS = [
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'captchaToken',
  'secret',
  'authorization',
  'cookie',
  'otp',
  // Confirm and reset links are as good as a password while they last.
  'url',
  // Encrypted job payloads.
  'sealed',
  'email',
  'newEmail',
  'phone',
  'contactPhone',
  'ipAddress',
  'addressText',
  'line1',
  'line2',
  'notes',
  'lat',
  'lng',
  'card',
  'licenseNumber',
] as const;

/**
 * `code` is a two-factor or backup code in form input, but also the diagnostic code on errors
 * (`err.code`, e.g. ECONNREFUSED), so only the places input travels in are covered.
 */
const INPUT_CONTAINERS = ['input', 'parsedInput', 'clientInput', 'body', 'query', 'data'] as const;

export const REDACT_PATHS = [
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`]),
  'code',
  ...INPUT_CONTAINERS.map((container) => `${container}.code`),
  'headers.cookie',
  'headers.authorization',
  'req.headers.cookie',
  'req.headers.authorization',
  'request.headers.cookie',
  'request.headers.authorization',
  '*.*.token',
  '*.*.password',
  'event.data.sealed',
];

const options: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'foodz' },
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  timestamp: pino.stdTimeFunctions.isoTime,
};

/** The app's logger; tests pass their own destination. */
export function createLogger(destination?: pino.DestinationStream) {
  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();

export type Logger = typeof logger;
