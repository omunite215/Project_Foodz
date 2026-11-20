/*
 * Tells this site's other tabs that the sign-in state changed, so they re-read it from the server
 * on the spot (S5.8, S3.2). Nothing personal is sent: only what happened.
 */

export type AuthEvent = 'signed-in' | 'signed-out' | 'email-confirmed';

const CHANNEL = 'foodz-auth';
const EVENTS: readonly AuthEvent[] = ['signed-in', 'signed-out', 'email-confirmed'];
const isAuthEvent = (value: unknown): value is AuthEvent =>
  typeof value === 'string' && (EVENTS as readonly string[]).includes(value);

export function postAuthEvent(type: AuthEvent): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(CHANNEL);
    // A BroadcastChannel only reaches this site's own tabs; it has no target origin to give.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    channel.postMessage({ type });
    channel.close();
  } catch {
    // Not available (old browser, private mode): other tabs notice on their next request.
  }
}

export function onAuthEvent(listener: (type: AuthEvent) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (data && typeof data === 'object' && 'type' in data && isAuthEvent(data.type)) {
      listener(data.type);
    }
  });
  return () => channel.close();
}

/*
 * A notice that greets the person after a navigation (the welcome notice after sign-up) takes
 * focus once it is drawn on the page they were sent to (S7.6). The form that caused it names
 * that page before navigating; the notice may already be drawn on the form's own page, from the
 * action's response, and must not take focus there.
 */
let noticeFocusPath: string | null = null;

/** `destination` is where the form is sending the person ("/menu?cuisine=thai" is fine). */
export function requestNoticeFocus(destination: string): void {
  noticeFocusPath = destination.split(/[?#]/)[0] || '/';
}

/** True once, on the page named by `requestNoticeFocus`. */
export function takeNoticeFocus(pathname: string): boolean {
  if (noticeFocusPath === null || noticeFocusPath !== pathname) return false;
  noticeFocusPath = null;
  return true;
}
