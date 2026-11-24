import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

// F5 A1.9, threat T22: staff pages are never indexed and never kept by the browser.
describe('/admin response headers', () => {
  it('are noindex and no-store for every staff page', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const admin = rules.find((rule) => rule.source === '/admin/:path*');
    expect(admin?.headers).toEqual(
      expect.arrayContaining([
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'Cache-Control', value: 'no-store' },
      ]),
    );
  });
});
