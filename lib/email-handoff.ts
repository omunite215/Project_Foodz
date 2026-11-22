/*
 * The email typed on one sign-in form, carried to the next (sign in → forgot password → sign in
 * again). Kept for this tab only, in sessionStorage: never in the URL, a cookie or a log
 * (design 3.8). Storage may be blocked; then each form simply starts empty.
 */

export const EMAIL_HANDOFF_KEY = 'foodz.auth.email';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const sessionStore = (): Store | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

export function rememberEmail(email: string, store: Store | null = sessionStore()): void {
  const value = email.trim();
  try {
    if (!value) store?.removeItem(EMAIL_HANDOFF_KEY);
    else if (value.length <= 254) store?.setItem(EMAIL_HANDOFF_KEY, value);
  } catch {
    // Storage full or blocked.
  }
}

export function recalledEmail(store: Store | null = sessionStore()): string {
  try {
    const value = store?.getItem(EMAIL_HANDOFF_KEY) ?? '';
    return value.length <= 254 ? value : '';
  } catch {
    return '';
  }
}

/** After a successful sign-in the email has done its job. */
export function forgetEmail(store: Store | null = sessionStore()): void {
  try {
    store?.removeItem(EMAIL_HANDOFF_KEY);
  } catch {
    // Storage blocked.
  }
}
