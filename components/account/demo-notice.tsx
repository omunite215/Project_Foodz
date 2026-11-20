'use client';

import { Users, X } from 'lucide-react';
import { gsap } from 'gsap';
import { useRef, useState } from 'react';
import { dismissNoticeAction } from '@/server/modules/account/actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { prefersReducedMotion } from '@/lib/motion';

export const DEMO_NOTICE_TEXT =
  "You're using the shared demo account. Other visitors use it too and it's reset every night, so please don't enter real personal details.";

/**
 * First on every account page for the shared demo accounts (S5.12). Dismissing it is remembered
 * for this browser session by a cookie the server reads, so it never flashes back.
 */
export function DemoNotice() {
  const [hidden, setHidden] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  if (hidden) return null;

  const hide = () => setHidden(true);

  return (
    <div ref={ref} className="mb-6 lg:mb-8">
      <Alert variant="warning" className="items-start">
        <Users aria-hidden />
        <AlertDescription>{DEMO_NOTICE_TEXT}</AlertDescription>
        <Button
          type="button"
          variant="ghost"
          size="icon-touch"
          aria-label="Dismiss"
          onClick={() => {
            // Remembered at once; the fade is only for the eye.
            void dismissNoticeAction({ notice: 'demo' });
            if (!ref.current || prefersReducedMotion()) {
              hide();
              return;
            }
            gsap.to(ref.current, {
              opacity: 0,
              duration: 0.16,
              ease: 'power2.in',
              onComplete: hide,
            });
          }}
          className="-my-2.5 text-neutral-1 hover:bg-white/60"
        >
          <X className="size-5" aria-hidden />
        </Button>
      </Alert>
    </div>
  );
}
