/*
 * Reading the answer of a Server Action in the browser. Every action returns
 * `{ data?, serverError?, validationErrors? }`; forms only need "it worked, here is the data" or
 * "it failed, here is what to show". Network trouble is folded into the same shape, so a form
 * handles one kind of failure.
 */

export const OFFLINE_MESSAGE =
  "You're offline. Your details are still here. Try again when you're back online.";
export const TIMEOUT_MESSAGE = 'This is taking too long. Check your connection and try again.';
export const INTERNAL_MESSAGE = 'Something went wrong. Please try again.';

/** A request still running after this long is given up on (S7.9). */
export const ACTION_TIMEOUT_MS = 15_000;

export interface ActionFailure {
  /** A server error code ("INVALID_CREDENTIALS"), or OFFLINE / TIMEOUT from the browser. */
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  retryAfterSeconds?: number;
  details?: Record<string, unknown>;
}

export type ActionOutcome<T> = { ok: true; data: T } | { ok: false; error: ActionFailure };

interface RawResult<T> {
  data?: T;
  serverError?: unknown;
  validationErrors?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `{ field: { _errors: ['…'] } }` (the formatted zod shape) as `{ field: ['…'] }`. */
export function fieldErrorsFrom(validationErrors: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!isRecord(validationErrors)) return result;
  for (const [field, value] of Object.entries(validationErrors)) {
    if (field === '_errors' || !isRecord(value) || !Array.isArray(value._errors)) continue;
    const messages = value._errors.filter((item): item is string => typeof item === 'string');
    if (messages.length) result[field] = messages;
  }
  return result;
}

function failureFrom(serverError: unknown): ActionFailure {
  if (!isRecord(serverError) || typeof serverError.message !== 'string') {
    return { code: 'INTERNAL', message: INTERNAL_MESSAGE };
  }
  return {
    code: typeof serverError.code === 'string' ? serverError.code : 'INTERNAL',
    message: serverError.message,
    ...(isRecord(serverError.fieldErrors) && {
      fieldErrors: fieldErrorsFrom(
        Object.fromEntries(
          Object.entries(serverError.fieldErrors).map(([key, value]) => [key, { _errors: value }]),
        ),
      ),
    }),
    ...(typeof serverError.retryAfterSeconds === 'number' && {
      retryAfterSeconds: serverError.retryAfterSeconds,
    }),
    ...(isRecord(serverError.details) && { details: serverError.details }),
  };
}

/** Turns what an action returned into a success or a failure the form can show. */
export function readActionResult<T>(result: RawResult<T> | undefined | null): ActionOutcome<T> {
  if (!result) return { ok: false, error: { code: 'INTERNAL', message: INTERNAL_MESSAGE } };
  if (result.serverError !== undefined)
    return { ok: false, error: failureFrom(result.serverError) };
  if (result.validationErrors !== undefined) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'Check the highlighted fields.',
        fieldErrors: fieldErrorsFrom(result.validationErrors),
      },
    };
  }
  // Every action answers with data on success; none at all means something went wrong.
  if (result.data === undefined) {
    return { ok: false, error: { code: 'INTERNAL', message: INTERNAL_MESSAGE } };
  }
  return { ok: true, data: result.data };
}

/** The browser says it has no network (where it can tell at all). */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine;
}

const offline = (): ActionOutcome<never> => ({
  ok: false,
  error: { code: 'OFFLINE', message: OFFLINE_MESSAGE },
});

/**
 * Calls an action with the browser's own failure cases handled: offline at the press, a request
 * that fails on the network, and one that takes longer than 15 seconds. A late answer after the
 * time-out is ignored.
 */
export async function callAction<T>(
  run: () => Promise<RawResult<T> | undefined>,
  { timeoutMs = ACTION_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<ActionOutcome<T>> {
  if (isOffline()) return offline();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ActionOutcome<T>>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, error: { code: 'TIMEOUT', message: TIMEOUT_MESSAGE } }),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([run().then((result) => readActionResult(result)), timeout]);
  } catch (error) {
    // A fetch that never reached the server.
    if (error instanceof TypeError) return offline();
    return { ok: false, error: { code: 'INTERNAL', message: INTERNAL_MESSAGE } };
  } finally {
    clearTimeout(timer);
  }
}

/** The first message for a field, from a failure. */
export const fieldError = (failure: ActionFailure | null | undefined, field: string) =>
  failure?.fieldErrors?.[field]?.[0];

/**
 * The failure once `field` has changed: the server judged the old value, so its error under that
 * field goes ("This password has appeared in a data breach" must not stick to a new password,
 * S7.5). A field-only failure with nothing left becomes null. Unchanged failures keep their
 * identity, so typing in a field without an error re-renders nothing.
 */
export function withoutFieldError(
  failure: ActionFailure | null,
  field: string,
): ActionFailure | null {
  if (!failure?.fieldErrors || !(field in failure.fieldErrors)) return failure;
  const rest = Object.fromEntries(
    Object.entries(failure.fieldErrors).filter(([name]) => name !== field),
  );
  if (Object.keys(rest).length === 0 && failure.code === 'INVALID_INPUT') return null;
  return { ...failure, fieldErrors: rest };
}
