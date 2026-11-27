import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createLogger, logger, serializeError } from './logger';

function capture(fields: Record<string, unknown>) {
  const lines: string[] = [];
  const log = createLogger({ write: (line: string) => lines.push(line) });
  log.warn(fields, 'test line');
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

const SECRET = 'do-not-log-me';

describe('logger redaction of live tracking (F8 L12)', () => {
  it('never writes a delivery code or a position, wherever it sits', () => {
    const line = JSON.stringify(
      capture({
        body: { code: '4071', cashCollected: true },
        input: { code: '4071' },
        point: { lat: 42.35532, lng: -71.05061 },
        lat: 42.35532,
        lng: -71.05061,
        courierPoint: { lat: 42.35532, lng: -71.05061 },
        routeGeojson: { type: 'LineString', coordinates: [[-71.045, 42.3505]] },
        coordinates: [[-71.045, 42.3505]],
        codeHash: 'a'.repeat(64),
        deliveryId: 'd1',
      }),
    );
    expect(line).not.toMatch(/4071|42\.35|71\.05|71\.045|aaaa/);
    expect(line).toContain('d1');
  });
});

describe('logger redaction', () => {
  it.each([
    'password',
    'newPassword',
    'currentPassword',
    'token',
    'captchaToken',
    'secret',
    'cookie',
    'url',
    'sealed',
    'email',
    'newEmail',
    'phone',
    'ipAddress',
    'line1',
    'line2',
    'notes',
    'lat',
    'lng',
    'code',
    'clientSecret',
    'contactName',
    'kitchenNote',
    'addressLabel',
    'addressLine1',
    'addressLine2',
    'addressCity',
    'courierInstructions',
    'note',
    'comment',
    'staffNote',
    'excludedNote',
    'partnerMessage',
    'reference',
  ])('hides %s at the top level and in form input', (key) => {
    const line = capture({ [key]: SECRET, input: { [key]: SECRET } });
    expect(line[key]).toBe('[redacted]');
    expect(line.input).toEqual({ [key]: '[redacted]' });
    expect(JSON.stringify(line)).not.toContain(SECRET);
  });

  it('hides one level down for any parent', () => {
    const line = capture({
      user: { email: SECRET, newEmail: SECRET },
      address: { line2: SECRET, notes: SECRET, lat: 42.35, lng: -71.04 },
      event: { data: { sealed: SECRET } },
      req: { headers: { cookie: SECRET, authorization: SECRET } },
      nested: { deeper: { token: SECRET, password: SECRET } },
    });
    expect(JSON.stringify(line)).not.toContain(SECRET);
    expect(JSON.stringify(line)).not.toContain('42.35');
  });

  it('keeps error codes and the fields logs rely on', () => {
    const error = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
    const line = capture({ err: error, flow: 'sign-in', errorCode: 'INVALID_TOKEN', policy: 'x' });
    expect(line).toMatchObject({ flow: 'sign-in', errorCode: 'INVALID_TOKEN', policy: 'x' });
    expect((line.err as { code?: string }).code).toBe('ECONNREFUSED');
  });
});

/** The same shape as the pg adapter's DriverAdapterError: Postgres's fields on `cause`. */
class AdapterError extends Error {
  override name = 'DriverAdapterError';
  override cause: Record<string, unknown>;
  constructor(payload: Record<string, unknown>) {
    super(String(payload.message));
    this.cause = payload;
  }
}

const ROW = `Failing row contains (Maya Lopez, +16175550123, 1 Faneuil Hall Square, ${SECRET}).`;
const CHECK_MESSAGE = 'new row for relation "orders" violates check constraint "orders_tip_limit"';

/** The pg adapter's error for a failed check: Postgres's `detail` holds the whole row. */
const adapterErrorFor = () =>
  new AdapterError({
    kind: 'postgres',
    code: '23514',
    severity: 'ERROR',
    message: CHECK_MESSAGE,
    detail: ROW,
    originalCode: '23514',
    originalMessage: CHECK_MESSAGE,
  });

/** What Prisma 7 throws for a failed check constraint on an insert (P2039). */
function checkViolation(adapterError = adapterErrorFor()) {
  return new PrismaClientKnownRequestError(
    `Database error. Code: \`23514\`. Message: \`${CHECK_MESSAGE}\``,
    {
      code: 'P2039',
      clientVersion: '7.10.1',
      meta: { modelName: 'Order', driverAdapterError: adapterError },
    },
  );
}

describe('logged errors (security S4)', () => {
  it('keep the failing row Postgres reports out, and the code, model and message in', () => {
    const line = capture({ err: checkViolation(), action: 'placeOrder' });
    expect(JSON.stringify(line)).not.toContain(SECRET);
    expect(JSON.stringify(line)).not.toContain('Failing row');
    expect(line.err).toMatchObject({
      type: 'PrismaClientKnownRequestError',
      code: 'P2039',
      message: expect.stringContaining('orders_tip_limit'),
      meta: { modelName: 'Order' },
    });
    expect(line.err).toHaveProperty('stack');
  });

  it('keep them out however the error arrives', () => {
    const adapterError = adapterErrorFor();
    const wrapped = Object.assign(new Error('order write failed', { cause: checkViolation() }), {
      original: checkViolation(),
    });
    const lines: string[] = [];
    const log = createLogger({ write: (text: string) => lines.push(text) });
    log.error({ err: adapterError }, 'adapter error');
    log.error({ err: wrapped }, 'wrapped');
    log.error(checkViolation(), 'as the first argument');
    log.error({ err: new AggregateError([checkViolation()], 'several') }, 'aggregate');
    expect(lines).toHaveLength(4);
    for (const text of lines) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('Failing row');
    }
  });

  it('leave non-errors and the original error untouched', () => {
    const adapterError = adapterErrorFor();
    capture({ err: checkViolation(adapterError) });
    expect(adapterError.cause.detail).toBe(ROW);
    expect(serializeError('not an error')).toBe('not an error');
  });

  it('are serialized this way by the shared logger the action wrapper uses', () => {
    const serializers = (logger as unknown as Record<symbol, Record<string, unknown>>)[
      pino.symbols.serializersSym
    ];
    expect(serializers?.err).toBe(serializeError);
  });
});
