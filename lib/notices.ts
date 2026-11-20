/**
 * Cookies behind the notices the root layout renders (design 1.5). None holds personal data:
 * the welcome notice reads the email from the session.
 */
export const NOTICE_COOKIES = {
  /** "Welcome, Maya. We sent a link to…": until dismissed or the email is confirmed. */
  welcome: 'foodz_welcome',
  /** One page view: 'email-confirmed' or 'account-deleted'. The browser clears it after mount. */
  flash: 'foodz_flash',
  /** The demo account notice was dismissed for this browser session. */
  demo: 'foodz_demo_notice',
} as const;

export const FLASH_NOTICES = ['email-confirmed', 'account-deleted'] as const;
export type FlashNotice = (typeof FLASH_NOTICES)[number];

export const isFlashNotice = (value: unknown): value is FlashNotice =>
  typeof value === 'string' && (FLASH_NOTICES as readonly string[]).includes(value);
