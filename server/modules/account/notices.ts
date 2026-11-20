import 'server-only';
import { cookies } from 'next/headers';
import { type FlashNotice, isFlashNotice, NOTICE_COOKIES } from '@/lib/notices';

const secure = () => process.env.NEXT_PUBLIC_SITE_URL?.startsWith('https://') ?? false;

export interface Notices {
  welcome: boolean;
  flash: FlashNotice | null;
  demoNoticeDismissed: boolean;
}

/** For the root layout: which notices to render in the first HTML. */
export async function readNotices(): Promise<Notices> {
  const jar = await cookies();
  const flash = jar.get(NOTICE_COOKIES.flash)?.value;
  return {
    welcome: jar.get(NOTICE_COOKIES.welcome)?.value === '1',
    flash: isFlashNotice(flash) ? flash : null,
    demoNoticeDismissed: jar.get(NOTICE_COOKIES.demo)?.value === '1',
  };
}

/** Set after sign-up; the layout shows it until dismissed or the email is confirmed. */
export async function setWelcomeNotice() {
  (await cookies()).set(NOTICE_COOKIES.welcome, '1', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: secure(),
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** A one-page-view notice. Readable by the browser, which clears it after showing it. */
export async function setFlashNotice(notice: FlashNotice) {
  (await cookies()).set(NOTICE_COOKIES.flash, notice, flashCookieOptions());
}

export const flashCookieOptions = () => ({
  path: '/',
  httpOnly: false,
  sameSite: 'lax' as const,
  secure: secure(),
  maxAge: 300,
});

export async function dismissNotice(notice: 'welcome' | 'flash' | 'demo') {
  const jar = await cookies();
  if (notice === 'demo') {
    // A browser-session cookie: the notice comes back next visit.
    jar.set(NOTICE_COOKIES.demo, '1', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: secure(),
    });
    return;
  }
  jar.delete(NOTICE_COOKIES[notice]);
}
