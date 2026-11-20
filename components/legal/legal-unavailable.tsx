'use client';

import { useRouter } from 'next/navigation';
import { PageContainer } from '@/components/layout/page-container';
import { ErrorState } from '@/components/states/error-state';

/** The page's content could not be read: plain words and a real "Try again". */
export function LegalUnavailable() {
  const router = useRouter();
  return (
    <PageContainer className="py-15 md:py-20">
      <ErrorState
        titleAs="h1"
        title="We couldn't load this page"
        description="Please try again in a moment."
        onRetry={() => router.refresh()}
      />
    </PageContainer>
  );
}
