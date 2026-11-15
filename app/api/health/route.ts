import { checkHealth } from '@/server/modules/system/service';

// Readiness probe for containers and uptime checks. Reports only up/down, never details.
export async function GET() {
  const ok = await checkHealth();
  return Response.json(
    { ok },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
