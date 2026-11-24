import type { Page } from '@playwright/test';

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
