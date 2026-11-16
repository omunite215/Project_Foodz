'use client';

import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from './empty-state';

/**
 * Something could not be loaded: plain words and a "Try again" that really asks again. Never a
 * stack trace, and the header and footer stay usable around it.
 */
export function ErrorState({
  title,
  description = 'Check your connection and try again.',
  onRetry,
  titleAs,
  className,
}: {
  title: string;
  description?: string;
  onRetry: () => void;
  titleAs?: 'h1' | 'h2' | 'h3';
  className?: string;
}) {
  const [retrying, setRetrying] = useState(false);

  return (
    <EmptyState
      illustration="warning"
      title={title}
      description={description}
      titleAs={titleAs}
      className={className}
      action={
        <Button
          type="button"
          variant="outline"
          size="touch"
          aria-disabled={retrying || undefined}
          onClick={() => {
            if (retrying) return;
            setRetrying(true);
            onRetry();
            // A retry that fails again re-renders this state; allow another try after a moment.
            setTimeout(() => setRetrying(false), 1500);
          }}
          className="border-brand-strong text-brand-strong"
        >
          <RefreshCw
            className="size-4 motion-safe:data-[spinning=true]:animate-spin"
            data-spinning={retrying}
            aria-hidden
          />
          Try again
        </Button>
      }
    />
  );
}
