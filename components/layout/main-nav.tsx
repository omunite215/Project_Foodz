'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isCurrentSection, NAV_LINKS } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/** The desktop navigation (from `lg`). The current section is marked visually and for screen readers. */
export function MainNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="hidden lg:block">
      <ul className="flex items-center gap-8">
        {NAV_LINKS.map((link) => {
          const current = isCurrentSection(link.href, pathname);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'relative inline-flex h-11 items-center text-button-1 font-medium text-muted-foreground transition-colors hover:text-neutral-2',
                  current &&
                    'text-brand-strong after:absolute after:inset-x-0 after:bottom-1.5 after:h-0.5 after:bg-brand-strong hover:text-brand-strong',
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
