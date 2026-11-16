'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';

type CopyState = 'idle' | 'copied' | 'blocked';

/**
 * Copies a coupon code. Confirms "Code copied" on the button and to screen readers for 2 s; if
 * the browser blocks the clipboard it says how to copy it by hand instead.
 */
export function CopyCodeButton({ code }: { code: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(code);
      setState('copied');
      announce('Code copied');
    } catch {
      setState('blocked');
      announce('Select the code to copy it');
    }
    timer.current = setTimeout(() => setState('idle'), 2000);
  };

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="touch"
        onClick={() => void copy()}
        className="border-brand-strong bg-white text-neutral-1 hover:bg-neutral-7"
      >
        <span className="relative size-4" aria-hidden>
          <Copy
            className={`absolute inset-0 size-4 transition-opacity duration-150 ${state === 'copied' ? 'opacity-0' : 'opacity-100'}`}
          />
          <Check
            className={`absolute inset-0 size-4 transition-opacity duration-150 ${state === 'copied' ? 'opacity-100' : 'opacity-0'}`}
          />
        </span>
        {state === 'copied' ? 'Code copied' : 'Copy code'}
      </Button>
      {state === 'blocked' ? (
        <p className="text-body-5 text-neutral-2">Select the code to copy it</p>
      ) : null}
    </div>
  );
}
