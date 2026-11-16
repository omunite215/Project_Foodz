'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { ErrorState } from '@/components/states/error-state';

/** The menu or a dish could not be loaded: say so, offer "Try again"; header and footer stay. */
export default function MenuError({ error, retry }: { error: unknown; retry: () => void }) {
  const pathname = usePathname();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageContainer className="py-15 md:py-20">
      <ErrorState
        titleAs="h1"
        title={pathname === '/menu' ? "We couldn't load the menu" : "We couldn't load this dish"}
        onRetry={retry}
      />
    </PageContainer>
  );
}
