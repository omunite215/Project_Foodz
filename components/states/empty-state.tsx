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
  eatingTogether: '/illustrations/eating-together.svg',
  deliveryAddress: '/illustrations/delivery-address.svg',
  mobileInbox: '/illustrations/mobile-inbox.svg',
  mailSent: '/illustrations/mail-sent.svg',
  // F3 states. Until the unDraw "Empty cart", "Searching" and favorites artwork is added
  // (design, Illustrations table), they use shipped illustrations from the same set. No
  // results shows a cook rather than the 404 art, which would read as a broken page.
  emptyCart: '/illustrations/order-food.svg',
  searching: '/illustrations/cooking.svg',
  favorites: '/illustrations/order-food.svg',
  // F5's empty board and "Nothing here yet". Until the unDraw "No data" artwork is added
  // (F5 design, Illustrations), they use the shipped cook from the same set.
  noData: '/illustrations/cooking.svg',
} as const;

export interface EmptyStateProps {
  title: string;
  description: string;
  /** One action: a button or a link styled as one. */
  action?: ReactNode;
  illustration?: keyof typeof ILLUSTRATIONS;
  /** A picture other than an illustration (an icon in a disc), decorative. */
  media?: ReactNode;
  /** The illustration's size: `compact` is 120 / 160 px (the empty board). */
  illustrationSize?: 'default' | 'compact';
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
  media,
  illustrationSize = 'default',
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
              className={cn(
                'object-contain',
                illustrationSize === 'compact' ? 'size-30 md:size-40' : 'size-40 md:size-50',
              )}
            />
          </EmptyMedia>
        ) : media ? (
          <EmptyMedia className="mb-0">{media}</EmptyMedia>
        ) : null}
        <EmptyTitle
          className={cn(
            'font-heading font-normal tracking-normal text-neutral-2',
            (illustration || media) && 'mt-6',
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
