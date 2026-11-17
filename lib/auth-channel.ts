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
 * A notice that appears after a navigation (the welcome notice after sign-up) takes focus once
 * it is drawn (S7.6). The form that caused it asks for that before navigating.
 */
let noticeFocusPending = false;

export function requestNoticeFocus(): void {
  noticeFocusPending = true;
}

export function takeNoticeFocus(): boolean {
  const pending = noticeFocusPending;
  noticeFocusPending = false;
  return pending;
}
