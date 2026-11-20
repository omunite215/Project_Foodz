'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useMotion } from '@/lib/motion';
import { isCurrentSection, NAV_LINKS } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { useAuthHref } from './account-entry';

const DESKTOP = '(min-width: 1024px)';

/**
 * The phone and tablet menu: a disclosure button, not a dialog. It opens below the header and
 * moves focus to the first link. It closes on Escape (focus back on the button), on a link, on a
 * route change, when focus or a click lands outside the header, and at the desktop width.
 */
export function MobileNav({ signedIn }: { signedIn: boolean }) {
  // The page the menu was opened on: navigating anywhere else closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const pathname = usePathname();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const signInHref = useAuthHref('/sign-in');
  const signUpHref = useAuthHref('/sign-up');

  const isOpen = openOn === pathname;
  const close = () => setOpenOn(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    firstLinkRef.current?.focus();

    const header = buttonRef.current?.closest('header');
    const outside = (target: EventTarget | null) =>
      Boolean(header && target instanceof Node && !header.contains(target));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenOn(null);
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (outside(event.target)) setOpenOn(null);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (outside(event.target)) setOpenOn(null);
    };
    const desktop = window.matchMedia(DESKTOP);
    const onWidthChange = () => {
      if (desktop.matches) setOpenOn(null);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    desktop.addEventListener('change', onWidthChange);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
      desktop.removeEventListener('change', onWidthChange);
    };
  }, [isOpen]);

  useMotion(
    (motion) => {
      if (!isOpen || !panelRef.current) return;
      motion.fromTo(
        panelRef.current,
        { y: -8, opacity: 0 },
        { y: 0, opacity: 1, duration: motion.reduced ? 0.12 : 0.2, ease: 'power2.out' },
      );
    },
    { scope: panelRef, dependencies: [isOpen] },
  );

  return (
    <div className="lg:hidden">
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="icon-touch"
        aria-expanded={isOpen}
        aria-controls="mobile-nav"
        onClick={() => setOpenOn(isOpen ? null : pathname)}
        className="text-neutral-2 hover:bg-neutral-7"
      >
        {isOpen ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
        <span className="sr-only">Menu</span>
      </Button>
      <div
        ref={panelRef}
        id="mobile-nav"
        hidden={!isOpen}
        className="absolute inset-x-0 top-full z-40 border-t border-neutral-6 bg-neutral-8 shadow-raised"
      >
        <nav aria-label="Main">
          <ul className="py-2">
            {NAV_LINKS.map((link, index) => {
              const current = isCurrentSection(link.href, pathname);
              return (
                <li key={link.href}>
                  <Link
                    ref={index === 0 ? firstLinkRef : undefined}
                    href={link.href}
                    aria-current={current ? 'page' : undefined}
                    onClick={close}
                    className={cn(
                      'flex h-12 items-center border-l-4 border-transparent px-6 text-body-3 font-medium text-neutral-2 hover:bg-neutral-7 focus-visible:-outline-offset-2',
                      current && 'border-brand-strong text-brand-strong',
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex flex-col gap-3 px-6 pt-2 pb-6">
          <Button asChild size="touch" className="w-full uppercase">
            <Link href="/menu" onClick={close}>
              Order now
            </Link>
          </Button>
          {signedIn ? null : (
            <>
              <Button
                asChild
                variant="outline"
                size="touch"
                className="w-full border-brand-strong bg-transparent text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
              >
                <Link href={signInHref} onClick={close}>
                  Sign in
                </Link>
              </Button>
              <Link
                href={signUpHref}
                onClick={close}
                className="flex h-11 items-center justify-center text-button-1 font-medium text-brand-strong underline-offset-4 hover:underline"
              >
                Create an account
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
