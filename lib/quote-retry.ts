/**
 * A quote that took longer than the wait is asked once more on its own: one slow answer (a busy
 * moment, a page action ahead of it) shouldn't leave the total showing "not available". Other
 * failures are shown at once, and too many quotes wait out their own limit (B5).
 */
export const retryQuote = (failureCount: number, failureCode: string | null): boolean =>
  failureCount < 1 && failureCode === 'TIMEOUT';
