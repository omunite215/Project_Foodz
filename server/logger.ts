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
  // Checkout (F4): a PaymentIntent's client secret lets anyone holding it confirm the payment.
  'clientSecret',
  'contactName',
  'kitchenNote',
  // F9: a customer's rating comment, staff notes, the partner's message and a payout reference.
  'comment',
  'staffNote',
  'excludedNote',
  'partnerMessage',
  'reference',
  // The delivery address and notes kept on an order.
  'addressLabel',
  'addressLine1',
  'addressLine2',
  'addressCity',
  'courierInstructions',
  'note',
  // Partner applications and locations (F6 contract section 10).
  'idNumber',
  'points',
  'point',
  'accuracy',
  'heading',
  'speed',
  'staffNote',
  'applicantText',
  'photoKey',
  'idDocumentKey',
  // Live tracking (F8 L12): positions, routes and the delivery code in any shape.
  'lat',
  'lng',
  'latitude',
  'longitude',
  'location',
  'courierPoint',
  'dropoffPoint',
  'routeGeojson',
  'routeGeoJson',
  'geojson',
  'coordinates',
  'codeEnc',
  'codeHash',
  'typedHash',
  'deliveryCode',
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
  // A reviewer's message or reason (F6): only in input, since errors carry a `message` of their own.
  ...INPUT_CONTAINERS.flatMap((container) => [`${container}.message`, `${container}.reason`]),
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

/*
 * Database errors carry the rejected row: for a failed check, Prisma keeps Postgres's `detail`
 * ("Failing row contains (…)", every column of the row, contact and address included) under
 * `meta.driverAdapterError`, and pino's error serializer copies `meta` as it is. Redaction only
 * matches key names a level or two deep, so errors are cleaned here instead: Prisma's `meta`
 * keeps names (model, fields, constraint) and never values, and `detail` is dropped wherever it
 * appears.
 */
const SAFE_META_KEYS = ['modelName', 'target', 'field_name', 'constraint', 'cause'] as const;
const DROPPED_ERROR_KEYS = new Set(['detail', 'driverAdapterError']);
const MAX_ERROR_DEPTH = 6;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]';

const isNameList = (value: unknown) =>
  typeof value === 'string' ||
  (Array.isArray(value) && value.every((item) => typeof item === 'string'));

function safeMeta(meta: unknown) {
  if (!isPlainObject(meta)) return undefined;
  return Object.fromEntries(
    SAFE_META_KEYS.flatMap((key) => (isNameList(meta[key]) ? [[key, meta[key]]] : [])),
  );
}

function scrubError(value: unknown, depth: number): unknown {
  if (depth > MAX_ERROR_DEPTH) return '[omitted]';
  if (value instanceof Error) return scrubError(pino.stdSerializers.err(value), depth + 1);
  if (Array.isArray(value)) return value.map((item) => scrubError(item, depth + 1));
  if (!isPlainObject(value)) return value;
  const cleaned: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (DROPPED_ERROR_KEYS.has(key)) continue;
    cleaned[key] = key === 'meta' ? safeMeta(inner) : scrubError(inner, depth + 1);
  }
  return cleaned;
}

/** What pino's own serializer treats as an error: anything with a string message. */
const isErrorLike = (value: unknown): value is Error =>
  typeof value === 'object' &&
  value !== null &&
  'message' in value &&
  typeof value.message === 'string';

/** pino's error serializer, without the database's copy of the row (see above). */
export function serializeError(error: unknown): unknown {
  return scrubError(isErrorLike(error) ? pino.stdSerializers.err(error) : error, 0);
}

const options: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'foodz' },
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  serializers: { err: serializeError },
  timestamp: pino.stdTimeFunctions.isoTime,
};

/** The app's logger; tests pass their own destination. */
export function createLogger(destination?: pino.DestinationStream) {
  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();

export type Logger = typeof logger;
