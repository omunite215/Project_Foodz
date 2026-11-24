import type { Page } from '@playwright/test';

/**
 * Waits, at most `timeoutMs`, until the document has loaded and has its tab title. Next streams
 * a page's metadata, so right after a client navigation the new content can be on screen a
 * moment before its `<title>`; a scan then would report a missing title nobody perceives. When
 * the wait runs out the scan goes ahead and reports what it finds.
 */
export async function settleDocument(page: Page, timeoutMs = 5_000) {
  await page
    .waitForFunction(
      () => document.readyState === 'complete' && document.title.trim().length > 0,
      undefined,
      { timeout: timeoutMs },
    )
    .catch(() => undefined);
}

/** Everything an accessibility scan should wait for: the document, then its animations. */
export async function settleBeforeScan(page: Page) {
  await settleDocument(page);
  await settleAnimations(page);
}

/**
 * Waits for every finite animation on the page to end, so a check doesn't measure a colour or
 * opacity half-way (a sheet sliding in, a button turning from blocked to ready). Pulses and
 * spinners repeat for ever and are left running.
 */
export async function settleAnimations(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}
