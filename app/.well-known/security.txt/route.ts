import { connection } from 'next/server';

// How to report a vulnerability (RFC 9116). Reports go through GitHub's private vulnerability
// reporting, so they reach the maintainer without being public.
const CONTACT = 'https://github.com/omunite215/Project_Foodz/security/advisories/new';
const VALID_FOR_DAYS = 180;

export async function GET() {
  // Generated per request so the required expiry date never goes stale.
  await connection();
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');
  const expires = new Date(Date.now() + VALID_FOR_DAYS * 24 * 60 * 60 * 1000);

  const body = [
    `Contact: ${CONTACT}`,
    `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
    'Preferred-Languages: en',
    ...(site ? [`Canonical: ${site}/.well-known/security.txt`] : []),
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
}
