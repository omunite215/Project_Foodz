import Image from 'next/image';
import type { ReactNode } from 'react';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { cn } from '@/lib/utils';

export const ILLUSTRATIONS = {
  pageEaten: '/illustrations/page-eaten.svg',
  warning: '/illustrations/warning.svg',
  orderFood: '/illustrations/order-food.svg',
} as const;

export interface EmptyStateProps {
  title: string;
  description: string;
  /** One action: a button or a link styled as one. */
  action?: ReactNode;
  illustration?: keyof typeof ILLUSTRATIONS;
  /** The heading level that fits the page outline. */
  titleAs?: 'h1' | 'h2' | 'h3';
  /** `page` for a whole page (dish not found), `section` inside a page. */
  size?: 'page' | 'section';
  className?: string;
}

/** One illustration, one line, one action. Used for empty, not-found and error states. */
export function EmptyState({
  title,
  description,
  action,
  illustration,
  titleAs: Title = 'h2',
  size = 'section',
  className,
}: EmptyStateProps) {
  return (
    <Empty className={cn('mx-auto max-w-sm gap-0 p-0', className)}>
      <EmptyHeader className="gap-0">
        {illustration ? (
          <EmptyMedia className="mb-0">
            <Image
              src={ILLUSTRATIONS[illustration]}
              alt=""
              width={200}
              height={200}
              unoptimized
              className="size-40 object-contain md:size-50"
            />
          </EmptyMedia>
        ) : null}
        <EmptyTitle
          className={cn(
            'font-heading font-normal tracking-normal text-neutral-2',
            illustration && 'mt-6',
            size === 'page' ? 'text-h4 md:text-h3' : 'text-title-1',
          )}
        >
          <Title className="text-balance">{title}</Title>
        </EmptyTitle>
        <EmptyDescription className="mt-3 text-body-4 text-neutral-3">
          {description}
        </EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent className="mt-8">{action}</EmptyContent> : null}
    </Empty>
  );
}
