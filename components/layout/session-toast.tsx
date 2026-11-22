'use client';

import { Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';

/*
 * A message about this device's session that the person must read ("You were signed out on this
 * device, so we emptied your cart."). It floats over the page, so it never moves the layout,
 * is announced once, and stays until dismissed (design 1.4).
 */

export const SIGNED_OUT_ELSEWHERE_TEXT =
  'You were signed out on this device, so we emptied your cart.';
export const SIGN_OUT_OFFLINE_TEXT =
  "You're offline. Try signing out again when you're back online.";
export const SIGN_OUT_FAILED_TEXT = "We couldn't sign you out. Please try again.";

type Listener = (text: string) => void;
const listeners = new Set<Listener>();

export function showSessionToast(text: string): void {
  for (const listener of listeners) listener(text);
  announce(text);
}

export function SessionToast() {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    listeners.add(setText);
    return () => {
      listeners.delete(setText);
    };
  }, []);

  if (!text) return null;
  return (
    <div className="fixed inset-x-4 bottom-4 z-40 md:right-6 md:left-auto md:w-[400px]">
      <Alert variant="info" className="items-center shadow-raised">
        <Info aria-hidden />
        <AlertDescription>{text}</AlertDescription>
        <Button
          type="button"
          variant="ghost"
          size="icon-touch"
          aria-label="Dismiss"
          onClick={() => setText(null)}
          className="-my-1.5 text-neutral-1 hover:bg-white/60"
        >
          <X className="size-5" aria-hidden />
        </Button>
      </Alert>
    </div>
  );
}
