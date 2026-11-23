'use client';

import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { COLUMN_OF } from '@/server/modules/board/schema';
import { cardTiming } from '@/server/modules/board/timing';
import { StaffGate } from '@/components/admin/staff-gate';
import { useStaffShell } from '@/components/admin/staff-shell-context';
import { FormAlert } from '@/components/forms/form-alert';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { timeBlockText } from '@/lib/board/text';
import { useBoardCard } from '@/lib/data/board';
import { columnHeadingId } from '../board-column';
import { DishList, PaymentChip, TimeBlock } from '../card-parts';
import { orderHeadingId } from '../order-card';
import { DetailNotFound, StaffOrderDetailView, useStaffOrderDetail } from './staff-order-detail';

/*
 * The detail as a 480 px panel over the live board (F5 design 5.1), opened from a card, its
 * "Details" item or Find. The address is the order's (an intercepted route); Close, Escape or
 * Back close it and focus returns to the card's heading, or its column's heading if it left.
 * What the card already knows shows at once; the rest after 150 ms of loading, as skeletons.
 */

const SKELETON_AFTER_MS = 150;

function Skeletons({ number }: { number: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), SKELETON_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div aria-busy className="space-y-6 px-6 py-5">
      <span className="sr-only">Loading order {number}</span>
      {show
        ? [6, 10, 8, 12].map((rem) => (
            <div
              key={rem}
              aria-hidden
              className="rounded-xl bg-neutral-7 motion-safe:animate-skeleton"
              style={{ height: `${rem}rem` }}
            />
          ))
        : null}
    </div>
  );
}

export function DetailPanel({ orderId }: { orderId: string }) {
  const router = useRouter();
  const shell = useStaffShell();
  const card = useBoardCard(orderId);
  const detail = useStaffOrderDetail(orderId);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const number = detail.data?.number ?? card?.number ?? '';
  const timeZone = shell.timeZone;
  const notFound = detail.error instanceof DetailNotFound;
  const [openedAt] = useState(() => new Date());

  const close = () => {
    setOpen(false);
    router.back();
  };

  const closeButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-kitchen"
      aria-label={number ? `Close order ${number}` : 'Close'}
      onClick={close}
      className="-mt-2 -mr-3 shrink-0"
    >
      <X className="size-5" aria-hidden />
    </Button>
  );

  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => titleRef.current?.focus());
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // Back to the card's heading, or its column's heading if the card has left (A10.1).
          requestAnimationFrame(() => {
            const link = document.querySelector<HTMLElement>(
              `#${CSS.escape(orderHeadingId(orderId))} a`,
            );
            const column = card
              ? document.getElementById(columnHeadingId(COLUMN_OF[card.status]))
              : null;
            (link ?? column)?.focus();
          });
        }}
        className="inset-y-0 right-0 h-full w-full overflow-y-auto bg-white shadow-raised md:w-[480px] motion-safe:data-[state=closed]:slide-out-to-right motion-safe:data-[state=closed]:duration-200 motion-safe:data-[state=open]:slide-in-from-right motion-safe:data-[state=open]:duration-280 max-md:motion-safe:data-[state=open]:slide-in-from-bottom-6"
      >
        {detail.data ? (
          <StaffOrderDetailView
            detail={detail.data}
            variant="panel"
            timeZone={timeZone}
            titleRef={titleRef}
            closeButton={closeButton}
            onSignedOut={() => setSignedOut(true)}
          />
        ) : (
          <>
            <header className="sticky top-0 z-10 border-b border-neutral-6 bg-white px-6 pt-5 pb-4">
              <div className="flex items-start justify-between gap-3">
                <SheetTitle
                  ref={titleRef}
                  tabIndex={-1}
                  className="font-heading text-title-1 text-neutral-2 tabular-nums outline-none"
                >
                  {notFound ? 'Order not found' : number ? `Order ${number}` : 'Order'}
                </SheetTitle>
                {closeButton}
              </div>
              {card && !detail.error ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <TimeBlock text={timeBlockText(cardTiming(card, openedAt), card, timeZone)} />
                  <PaymentChip payment={card.payment} />
                </div>
              ) : null}
            </header>
            {notFound ? (
              <StaffGate kind="notFound" titleAs="h2" />
            ) : detail.error ? (
              <div className="px-6 py-5">
                <FormAlert
                  variant="error"
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      size="kitchen"
                      onClick={() => void detail.refetch()}
                    >
                      Try again
                    </Button>
                  }
                >
                  We couldn&apos;t load order {number}. Try again.
                </FormAlert>
              </div>
            ) : (
              <>
                {card ? (
                  <div className="px-6 pt-5">
                    <DishList lines={card.lines} showSoldOut={false} />
                  </div>
                ) : null}
                <Skeletons number={number} />
              </>
            )}
          </>
        )}
        {signedOut ? (
          <div className="px-6 pb-6">
            <FormAlert variant="info">
              You&apos;ve been signed out. Sign in again to keep the board live.
            </FormAlert>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
