'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Cuisine } from '@/server/db/enums';
import { menuTabHref } from '@/server/modules/menu/urls';
import { Button } from '@/components/ui/button';
import { pathOf } from '@/lib/navigation';
import { previousRoute } from '@/lib/route-memory';

/**
 * Back to the menu on this dish's cuisine tab. When the visitor came here from the menu, it
 * steps back through history instead, which brings back their tab and scroll position. From a
 * shared link (or without scripts) it simply opens the menu on the right tab.
 */
export function GoBackLink({ cuisine }: { cuisine: Cuisine }) {
  const router = useRouter();

  return (
    <Button
      asChild
      variant="outline"
      size="touch"
      className="border-brand-strong bg-transparent text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
    >
      <Link
        href={menuTabHref(cuisine)}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          const previous = previousRoute();
          if (previous && pathOf(previous) === '/menu') {
            event.preventDefault();
            router.back();
          }
        }}
      >
        <ArrowLeft className="size-6" aria-hidden />
        Go back
      </Link>
    </Button>
  );
}
