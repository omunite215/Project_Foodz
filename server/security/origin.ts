import 'server-only';

/**
 * Route handlers that act for the signed-in user only accept requests from the site itself.
 * Browsers send an Origin header on every POST, so a missing or foreign one is refused.
 */
export function isSameOrigin(request: Request, siteUrl = process.env.NEXT_PUBLIC_SITE_URL) {
  const origin = request.headers.get('origin');
  if (!origin || !siteUrl) return false;
  try {
    return new URL(origin).origin === new URL(siteUrl).origin;
  } catch {
    return false;
  }
}
