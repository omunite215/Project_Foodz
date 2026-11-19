'use client';

import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CaptchaAction } from '@/server/modules/auth/schema';
import { announce } from '@/lib/announce';

/*
 * Cloudflare Turnstile, run on submit (design 2.8). Most people never see it: the widget stays
 * empty unless Cloudflare wants an interaction, and then it appears under the submit button,
 * so the fields and the button never move. If the check cannot run (script blocked, offline,
 * an error, or no answer within 10 seconds), `token()` answers null and the form says so with
 * a working "Try again".
 */

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TOKEN_TIMEOUT_MS = 10_000;
export const CHALLENGE_TEXT = 'One more step: complete the quick security check below.';
export const CHECK_FAILED_TEXT =
  "We couldn't run our quick security check. Check your connection, then try again.";

interface TurnstileOptions {
  sitekey: string;
  action: CaptchaAction;
  appearance: 'interaction-only';
  execution: 'execute';
  size: 'flexible' | 'compact';
  theme: 'light';
  language: 'en';
  callback: (token: string) => void;
  'error-callback': () => boolean;
  'expired-callback': () => void;
  'timeout-callback': () => void;
  'unsupported-callback': () => void;
  'before-interactive-callback': () => void;
  'after-interactive-callback': () => void;
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileOptions): string | undefined;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    // Scripts added by the app's own (nonced) code are allowed by the CSP; carry the nonce too.
    const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
    if (nonce) script.nonce = nonce;
    script.addEventListener('load', () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile missing')),
    );
    script.addEventListener('error', () => {
      loading = undefined;
      script.remove();
      reject(new Error('Turnstile could not load'));
    });
    document.head.append(script);
  });
  return loading;
}

export interface TurnstileHandle {
  /** A fresh, single-use token, or null when the check could not run. */
  token(): Promise<string | null>;
}

export function Turnstile({
  ref,
  action,
  onChallenge,
}: {
  ref?: Ref<TurnstileHandle>;
  /**
   * Which form the check is for. Cloudflare signs it into the token and the server compares it,
   * so a token solved on one form can't be spent on another.
   */
  action: CaptchaAction;
  /** A puzzle is showing (the submit button then reads "Checking…"). */
  onChallenge?: (showing: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const usedRef = useRef(false);
  const waitingRef = useRef<((token: string | null) => void) | null>(null);
  const [challenge, setChallengeState] = useState(false);
  const setChallenge = (showing: boolean) => {
    setChallengeState(showing);
    onChallenge?.(showing);
  };

  const settle = (token: string | null) => {
    waitingRef.current?.(token);
    waitingRef.current = null;
  };

  useEffect(() => {
    const widgets = widgetRef;
    const waiting = waitingRef;
    return () => {
      if (widgets.current) window.turnstile?.remove(widgets.current);
      waiting.current?.(null);
      waiting.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    async token() {
      settle(null);
      const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
      const container = containerRef.current;
      if (!sitekey || !container) return null;
      let api: TurnstileApi;
      try {
        api = await loadTurnstile();
      } catch {
        return null;
      }

      return new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => settle(null), TOKEN_TIMEOUT_MS);
        waitingRef.current = (token) => {
          clearTimeout(timer);
          setChallenge(false);
          if (token === null && widgetRef.current) api.reset(widgetRef.current);
          resolve(token);
        };
        try {
          if (!widgetRef.current) {
            widgetRef.current =
              api.render(container, {
                sitekey,
                action,
                appearance: 'interaction-only',
                execution: 'execute',
                size: window.innerWidth < 360 ? 'compact' : 'flexible',
                theme: 'light',
                language: 'en',
                callback: (token) => settle(token),
                'error-callback': () => {
                  settle(null);
                  return true;
                },
                'expired-callback': () => {
                  usedRef.current = true;
                },
                'timeout-callback': () => settle(null),
                'unsupported-callback': () => settle(null),
                'before-interactive-callback': () => {
                  setChallenge(true);
                  announce(CHALLENGE_TEXT);
                },
                'after-interactive-callback': () => setChallenge(false),
              }) ?? null;
          } else if (usedRef.current) {
            api.reset(widgetRef.current);
          }
          if (!widgetRef.current) {
            settle(null);
            return;
          }
          usedRef.current = true;
          api.execute(widgetRef.current);
        } catch {
          settle(null);
        }
      });
    },
  }));

  return (
    <div className="mt-4">
      {challenge ? <p className="mb-3 text-body-5 text-neutral-3">{CHALLENGE_TEXT}</p> : null}
      {/* Cloudflare's frame; empty unless a challenge is needed. */}
      <div ref={containerRef} className="empty:hidden" />
    </div>
  );
}
