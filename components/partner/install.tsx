'use client';

import { Share, Smartphone } from 'lucide-react';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';

/*
 * Adding the partner app to the home screen (F6 design 2.6, P8.3, U23). Android Chrome and Edge
 * keep the browser's own install prompt for our button; iPhone Safari has no prompt, so it gets
 * the two steps in words. Nothing shows when the app already runs installed, or in a browser
 * that can't install it. "Not now" hides the card for 30 days on this phone.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isInstallPrompt = (event: Event): event is InstallPromptEvent =>
  'prompt' in event && typeof event.prompt === 'function';

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    if (!isInstallPrompt(event)) return;
    event.preventDefault();
    deferred = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type InstallWay = 'prompt' | 'ios' | null;

function installWay(): InstallWay {
  if (window.matchMedia('(display-mode: standalone)').matches) return null;
  if (deferred) return 'prompt';
  const ua = navigator.userAgent;
  const iPhone =
    /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return iPhone && safari ? 'ios' : null;
}

/** How this phone can install the app, or null (also in the server's HTML). */
function useInstallWay(): InstallWay {
  return useSyncExternalStore(subscribe, installWay, () => null);
}

async function promptInstall(onDone: () => void) {
  const event = deferred;
  if (!event) return;
  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === 'accepted') {
    deferred = null;
    notify();
    announce('Foodz Partner installed');
    onDone();
  }
}

function IosSteps() {
  return (
    <p className="mt-2 text-body-4 text-foreground">
      Tap Share
      <Share className="mx-1 inline size-[18px] align-text-bottom" aria-hidden />, then Add to Home
      Screen.
    </p>
  );
}

/** The welcome's "Install the app" (design 5.6). */
export function InstallButton() {
  const way = useInstallWay();
  const [steps, setSteps] = useState(false);
  if (!way) return null;
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="kitchen"
        className="w-full"
        aria-expanded={way === 'ios' ? steps : undefined}
        onClick={() => {
          if (way === 'prompt') void promptInstall(() => {});
          else setSteps(true);
        }}
      >
        Install the app
      </Button>
      {way === 'ios' && steps ? <IosSteps /> : null}
    </div>
  );
}

const DISMISS_KEY = 'foodz.partner-install-not-now';
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

function dismissedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

/** The offline home's card (design 2.6): under the kitchen line, never over "Go online". */
export function InstallCard() {
  const way = useInstallWay();
  const titleId = useId();
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setHidden(dismissedRecently()), 0);
    return () => clearTimeout(timer);
  }, []);
  if (!way || hidden) return null;

  const notNow = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Blocked: it simply shows again next time.
    }
    setHidden(true);
  };

  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted"
        >
          <Smartphone className="size-5 text-foreground" />
        </span>
        <h2 id={titleId} className="text-body-3 font-semibold text-strong">
          Add Foodz Partner to your home screen
        </h2>
      </div>
      {way === 'ios' ? <IosSteps /> : null}
      <div className="mt-3 flex gap-2">
        {way === 'prompt' ? (
          <Button type="button" size="kitchen" onClick={() => void promptInstall(notNow)}>
            Install
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="kitchen"
          className="text-strong"
          onClick={notNow}
        >
          Not now
        </Button>
      </div>
    </section>
  );
}
