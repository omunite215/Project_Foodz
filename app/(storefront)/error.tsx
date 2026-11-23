'use client';

import { useEffect } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { ErrorState } from '@/components/states/error-state';

/** A page failed to render: plain words and "Try again", never a stack trace. */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageContainer className="py-15 md:py-20">
      <ErrorState
        titleAs="h1"
        title="Something went wrong on our side"
        description="Please try again in a moment."
        onRetry={retry}
      />
    </PageContainer>
  );
}
