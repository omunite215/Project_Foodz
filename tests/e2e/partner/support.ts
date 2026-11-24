import type { Page, TestInfo } from '@playwright/test';
import { DEMO_PASSWORD, expect, open, SAMPLE_PASSWORD, test } from '../account/support';
import { expectNoAxeViolations } from '../admin/support';

/*
 * The partner app's suites (tests/e2e/partner). They use the F6 fixtures: run the seed with
 * sample accounts, then `npm run seed:partners` before each session. They run only with
 * E2E_PARTNER=1 (playwright.config.ts), at 360, 375 and 1440 px.
 */

export { DEMO_PASSWORD, expect, expectNoAxeViolations, open, SAMPLE_PASSWORD, test };

export const PARTNERS = {
  marco: 'applying.customer@foodz.example',
  ana: 'pending.partner@foodz.example',
  kwame: 'changes.partner@foodz.example',
  jonas: 'rejected.partner@foodz.example',
  mei: 'reapply.partner@foodz.example',
  diego: 'approved.partner@foodz.example',
  grace: 'stale.partner@foodz.example',
  victor: 'suspended.partner@foodz.example',
  riley: 'demo.partner@foodz.example',
} as const;

/** Route R from the story: the kitchen, then about 234 m a step towards Faneuil Hall. */
export const ROUTE = {
  R0: { latitude: 42.3505, longitude: -71.045 },
  R2: { latitude: 42.3537, longitude: -71.0487 },
} as const;

export const projectOf = (testInfo: TestInfo) => testInfo.project.name;

/**
 * axe on a screen taller than the phone: from its end, so no control sits half under the
 * sticky dock and tab bar at the moment of the check (target size counts only the uncovered
 * part, which depends on where the page happens to be scrolled).
 */
export async function expectNoAxeViolationsAtEnd(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expectNoAxeViolations(page);
}

/** Signs a partner or applicant in and lands on `path` (P7.3: partners land on /partner). */
export async function signInTo(page: Page, email: string, path = '/partner', password?: string) {
  await open(page, `/sign-in?callbackUrl=${encodeURIComponent(path)}`);
  await page.getByLabel('Email').fill(email);
  await page
    .getByLabel('Password', { exact: true })
    .fill(password ?? (email === PARTNERS.riley ? DEMO_PASSWORD : SAMPLE_PASSWORD));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname.startsWith('/partner'), { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
}
