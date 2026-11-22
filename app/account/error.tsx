'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/states/error-state';

/** An account page failed to load: plain words and "Try again"; the header and footer stay. */
export default function AccountError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="py-10">
      <ErrorState
        titleAs="h1"
        title="We couldn't load your account"
        description="Check your connection and try again."
        onRetry={retry}
      />
    </div>
  );
}
