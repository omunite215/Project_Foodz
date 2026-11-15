import { expect, type Page, test } from '@playwright/test';

const PAGES = ['/', '/menu', '/blog', '/contact', '/menu/korean/km01'] as const;

/** Collects console errors and CSP violations while a page loads. */
function watchForProblems(page: Page) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

for (const path of PAGES) {
  test(`${path} renders without errors or CSP violations`, async ({ page }) => {
    const problems = watchForProblems(page);
    const response = await page.goto(path);

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Foodz/);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(problems.filter((p) => !p.includes('favicon'))).toEqual([]);
  });
}

test('pages carry the security headers', async ({ request }) => {
  const response = await request.get('/menu');
  const headers = response.headers();

  expect(headers['content-security-policy']).toMatch(
    /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
  );
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toContain('geolocation=()');
  expect(headers['x-powered-by']).toBeUndefined();
});

test('each request gets a fresh nonce', async ({ request }) => {
  const nonceOf = async () =>
    /'nonce-([^']+)'/.exec(
      (await request.get('/')).headers()['content-security-policy'] ?? '',
    )?.[1];
  const [first, second] = [await nonceOf(), await nonceOf()];
  expect(first).toBeTruthy();
  expect(first).not.toBe(second);
});

test('the old contact URL redirects permanently', async ({ request }) => {
  const response = await request.get('/contact-us', { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe('/contact');
});

test('unknown dishes return 404', async ({ page }) => {
  const response = await page.goto('/menu/korean/does-not-exist');
  expect(response?.status()).toBe(404);
});

test('API and metadata responses get a policy that allows nothing', async ({ request }) => {
  for (const path of ['/api/health', '/robots.txt', '/sitemap.xml']) {
    const headers = (await request.get(path)).headers();
    expect(headers['content-security-policy'], path).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(headers['permissions-policy'], path).toContain('geolocation=()');
  }
});

test('robots.txt keeps private areas out of search engines', async ({ request }) => {
  const body = await (await request.get('/robots.txt')).text();
  for (const path of ['/admin', '/partner', '/account', '/checkout', '/api/']) {
    expect(body).toContain(`Disallow: ${path}`);
  }
});
