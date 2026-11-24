'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/states/error-state';

/** A staff page failed to render: plain words and "Try again", never a stack trace. */
export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-md px-4 py-16 md:py-24">
      <ErrorState
        titleAs="h1"
        title="Something went wrong on our side"
        description="Please try again in a moment."
        onRetry={retry}
      />
    </div>
  );
}
