import 'server-only';
import { headers } from 'next/headers';

export interface RequestInfo {
  ip: string;
  userAgent: string;
  requestId: string;
}

/** Client details for logging, auditing and rate limiting. */
export async function requestInfo(): Promise<RequestInfo> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return {
    ip: forwarded || h.get('x-real-ip') || 'unknown',
    userAgent: (h.get('user-agent') ?? '').slice(0, 300),
    requestId: h.get('x-request-id') ?? crypto.randomUUID(),
  };
}
