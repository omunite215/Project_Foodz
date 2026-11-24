import { isDeployedProduction } from './deployment';

/*
 * The client address used for rate limits and the audit log. A value the client can choose
 * freely would let it reset its own limits, so request headers are read only when something in
 * front of the app is known to write them:
 *
 * - On Vercel, `x-vercel-forwarded-for` is set by the platform and cannot be supplied by the
 *   client.
 * - Behind a proxy that overwrites `x-forwarded-for` with the socket address (and any further
 *   proxies that append to it), `TRUSTED_PROXY_HOPS` says how many there are. The client address
 *   is the entry that many places from the right; anything further left was written by the client.
 * - Otherwise nothing in the request identifies the client: App Router code cannot see the
 *   socket, and Next.js keeps an `x-forwarded-for` the client sent. Every client then shares one
 *   key, so the per-address limits act as limits for the whole site. A warning says so at start-up.
 * - `CLIENT_IP_FROM_HEADER=1` is a test-only switch (end-to-end and integration tests give each
 *   test its own address through `x-forwarded-for`). It is refused on Vercel production.
 *
 * No `server-only` here: the start-up check in server/env.ts runs from instrumentation.
 */

type Env = Record<string, string | undefined>;

/** The key every client shares when nothing trustworthy identifies it. */
export const UNKNOWN_CLIENT = 'unknown';

export type ClientIpSource = 'vercel' | 'proxy' | 'test-header' | 'none';

const MAX_HOPS = 5;

/** An address token (IPv4, IPv6, or a proxy's opaque name); keeps odd input out of limiter keys. */
const IP_LITERAL = /^[\w.:-]{1,64}$/;

const asIp = (value: string | null | undefined) => {
  const candidate = value?.trim();
  return candidate && IP_LITERAL.test(candidate) ? candidate : undefined;
};

const isOn = (value: string | undefined) => value === '1' || value === 'true';

export function trustedProxyHops(env: Env): number {
  const hops = Number.parseInt(env.TRUSTED_PROXY_HOPS ?? '0', 10);
  return Number.isFinite(hops) ? Math.min(Math.max(hops, 0), MAX_HOPS) : 0;
}

/** The test-only switch was set where it must never apply. */
export function clientIpOptInRefused(env: Env): boolean {
  return isOn(env.CLIENT_IP_FROM_HEADER) && isDeployedProduction(env);
}

/** Where this deployment takes the client address from. */
export function clientIpSource(env: Env): ClientIpSource {
  if (env.VERCEL) return 'vercel';
  if (trustedProxyHops(env) > 0) return 'proxy';
  if (isOn(env.CLIENT_IP_FROM_HEADER) && !clientIpOptInRefused(env)) return 'test-header';
  return 'none';
}

const forwardedChain = (source: Headers) =>
  (source.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

export function clientIp(source: Headers, env: Env): string {
  const from = clientIpSource(env);
  if (from === 'vercel') {
    return (
      asIp(source.get('x-vercel-forwarded-for')?.split(',')[0]) ??
      asIp(source.get('x-real-ip')) ??
      UNKNOWN_CLIENT
    );
  }
  if (from === 'proxy') {
    const chain = forwardedChain(source);
    if (chain.length === 0) return UNKNOWN_CLIENT;
    const index = Math.max(chain.length - trustedProxyHops(env), 0);
    return asIp(chain[index]) ?? UNKNOWN_CLIENT;
  }
  if (from === 'test-header') {
    const chain = forwardedChain(source);
    if (chain.length === 0) return asIp(source.get('x-real-ip')) ?? UNKNOWN_CLIENT;
    return asIp(chain.at(-1)) ?? UNKNOWN_CLIENT;
  }
  return UNKNOWN_CLIENT;
}

/** What to say at start-up about the client address, if anything. */
export function clientIpWarning(env: Env): string | null {
  switch (clientIpSource(env)) {
    case 'test-header':
      return 'CLIENT_IP_FROM_HEADER is on: rate limits trust the client-supplied X-Forwarded-For. Use it for tests only.';
    case 'none':
      return env.NODE_ENV === 'production'
        ? 'No trusted proxy (TRUSTED_PROXY_HOPS=0, not on Vercel): every client shares one rate-limit key. Put a proxy that overwrites X-Forwarded-For in front and set TRUSTED_PROXY_HOPS=1.'
        : null;
    default:
      return null;
  }
}

/**
 * The network a client address stands for in per-network limits. An IPv4 address is itself.
 * An IPv6 client usually holds a whole /64 and can pick any address in it, so IPv6 is counted
 * by its /64. An IPv4 address written in IPv6 form ("::ffff:203.0.113.9") is counted as IPv4.
 */
export function networkOf(ip: string): string {
  const address = (ip.split('%')[0] ?? ip).toLowerCase();
  if (!address.includes(':')) return address;
  const embedded = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (embedded?.[1]) return embedded[1];
  const halves = address.split('::');
  if (halves.length > 2) return address;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups =
    halves.length === 2
      ? [...head, ...Array<string>(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail]
      : head;
  if (groups.length !== 8 || !groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
    return address;
  }
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(':')}::/64`;
}
