import 'server-only';
import { headers } from 'next/headers';

export interface RequestInfo {
  ip: string;
  userAgent: string;
  requestId: string;
}

type Env = Record<string, string | undefined>;

const MAX_HOPS = 5;

/** An address token (IPv4, IPv6, or a proxy's opaque name); keeps odd input out of limiter keys. */
const IP_LITERAL = /^[\w.:-]{1,64}$/;

const asIp = (value: string | null | undefined) => {
  const candidate = value?.trim();
  return candidate && IP_LITERAL.test(candidate) ? candidate : undefined;
};

/**
 * The address of the client, as far as this deployment can trust it. Used for rate limits and
 * the audit log, so a value the client can choose freely would let it reset its own limits.
 *
 * - On Vercel, `x-vercel-forwarded-for` is set by the platform and cannot be supplied by the
 *   client.
 * - Elsewhere, `TRUSTED_PROXY_HOPS` says how many proxies in front of the app append to
 *   `x-forwarded-for`. The client address is the entry that many places from the right; anything
 *   further left was written by the client. With no proxy (0, the default) Next.js fills the
 *   header from the socket only when the client sent none, so the rightmost entry is used.
 */
export function clientIp(source: Headers, env: Env = process.env): string {
  if (env.VERCEL) {
    return (
      asIp(source.get('x-vercel-forwarded-for')?.split(',')[0]) ??
      asIp(source.get('x-real-ip')) ??
      'unknown'
    );
  }

  const hops = Math.min(
    Math.max(Number.parseInt(env.TRUSTED_PROXY_HOPS ?? '0', 10) || 0, 0),
    MAX_HOPS,
  );
  const chain = (source.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (chain.length === 0) return asIp(source.get('x-real-ip')) ?? 'unknown';

  const index = Math.max(chain.length - Math.max(hops, 1), 0);
  return asIp(chain[index]) ?? 'unknown';
}

/** Client details for logging, auditing and rate limiting. */
export async function requestInfo(): Promise<RequestInfo> {
  const h = await headers();
  return {
    ip: clientIp(h),
    userAgent: (h.get('user-agent') ?? '').slice(0, 300),
    requestId: h.get('x-request-id') ?? crypto.randomUUID(),
  };
}
