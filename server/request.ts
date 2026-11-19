import 'server-only';
import { headers } from 'next/headers';
import { clientIp as clientIpFrom } from './client-ip';

export interface RequestInfo {
  ip: string;
  userAgent: string;
  requestId: string;
}

/** The client address as far as this deployment can trust it (see server/client-ip.ts). */
export function clientIp(source: Headers): string {
  return clientIpFrom(source, process.env);
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
