'use client';

import { type LucideIcon, X } from 'lucide-react';
import { type ReactNode, useEffect, useEffectEvent, useRef } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import { useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/*
 * The banner stack under the top bar (F5 design 1.5): demo, session ending, connection, orders
 * waiting, hidden by filters, in that order. Each is a compact FormAlert row. Banners are never
 * live regions: a banner's words are announced once when it appears (the demo banner is part of
 * the page and isn't announced).
 */

export function BannerStack({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-2 px-4 pt-3 empty:hidden lg:px-6', className)}>{children}</div>
  );
}

export function Banner({
  variant,
  icon: Icon,
  children,
  action,
  onDismiss,
  announceOnShow = true,
  animateIn = true,
  className,
  ...props
}: {
  variant: 'info' | 'warning' | 'error' | 'success';
  icon: LucideIcon;
  children: ReactNode;
  /** One explicit button at the end ("Show order 1042", "Sign in again"). */
  action?: ReactNode;
  onDismiss?: () => void;
  /** Read the words out once when the banner appears. */
  announceOnShow?: boolean;
  /** Rise in when it appears; off for banners in the server's HTML (nothing first painted hides). */
  animateIn?: boolean;
  className?: string;
  'data-banner'?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const speak = useEffectEvent(() => {
    const text = textRef.current?.textContent;
    if (announceOnShow && text) announce(text);
  });

  useEffect(() => {
    speak();
  }, []);

  useMotion(
    (motion) => {
      if (!ref.current || !animateIn) return;
      motion.from(ref.current, {
        y: -4,
        opacity: 0,
        duration: motion.reduced ? 0 : 0.15,
        ease: 'power2.out',
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} data-banner={props['data-banner']}>
      <Alert
        variant={variant}
        className={cn(
          'items-center gap-3 px-4 py-2.5 text-body-5 md:text-body-4 [&>svg]:mt-0',
          className,
        )}
      >
        <Icon aria-hidden />
        <AlertDescription ref={textRef}>{children}</AlertDescription>
        {action ? <div className="shrink-0">{action}</div> : null}
        {onDismiss ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-touch"
            aria-label="Dismiss"
            onClick={onDismiss}
            className="-my-1 -mr-2 shrink-0 text-neutral-1 hover:bg-white/60"
          >
            <X className="size-5" aria-hidden />
          </Button>
        ) : null}
      </Alert>
    </div>
  );
}

/** The button inside a banner: outline on white, 48 px on the board (design 1.5). */
export function BannerAction({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="kitchen"
      onClick={onClick}
      className={cn('bg-white text-button-2 whitespace-nowrap', className)}
    >
      {children}
    </Button>
  );
}
