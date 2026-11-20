import { AppError } from '@/server/errors';
import { logger } from '@/server/logger';
import { handleStripeWebhook } from '@/server/modules/orders/webhook';
import { clientIp } from '@/server/request';
import { enforceRateLimit } from '@/server/security/rate-limit';

// Stripe's events (F4 B6). Stripe signs the raw body, so it is read as text and checked before
// anything is parsed. No cookies or session: the signature is the only credential.
const MAX_BODY_BYTES = 256 * 1024;

const answer = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Reads chunks until the end, or stops (null) once they pass the cap. */
async function collect(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  chunks: Uint8Array[],
  size: number,
): Promise<number | null> {
  const { done, value } = await reader.read();
  if (done) return size;
  const total = size + value.byteLength;
  if (total > MAX_BODY_BYTES) {
    await reader.cancel();
    return null;
  }
  chunks.push(value);
  return collect(reader, chunks, total);
}

/** The body as text, or null once it passes the size cap (a missing length is no excuse). */
async function readCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return null;
  if (!request.body) return '';
  const chunks: Uint8Array[] = [];
  const size = await collect(request.body.getReader(), chunks, 0);
  return size === null ? null : Buffer.concat(chunks).toString('utf8');
}

export async function POST(request: Request) {
  try {
    await enforceRateLimit('webhook.stripe', `ip:${clientIp(request.headers)}`);
  } catch (error) {
    if (error instanceof AppError) {
      return answer(error.status, { error: 'rate_limited' });
    }
    throw error;
  }

  const body = await readCapped(request);
  if (body === null) return answer(413, { error: 'too_large' });

  try {
    const result = await handleStripeWebhook(body, request.headers.get('stripe-signature'));
    return answer(result.status, { received: result.status === 200, outcome: result.outcome });
  } catch (error) {
    // Stripe retries a 5xx; the event id was not recorded, so the retry is applied in full.
    logger.error({ err: error }, 'stripe webhook failed');
    return answer(500, { error: 'failed' });
  }
}
