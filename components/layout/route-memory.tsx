'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { rememberRoute } from '@/lib/route-memory';

/** Records each route change so "Go back" knows where the visitor came from. */
export function RouteMemory() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    rememberRoute(search ? `${pathname}?${search}` : pathname);
  }, [pathname, search]);

  return null;
}
