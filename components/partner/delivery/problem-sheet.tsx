'use client';

import { useSelector } from '@tanstack/react-store';
import {
  Ban,
  CircleHelp,
  DoorClosed,
  type LucideIcon,
  SearchX,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { ProblemKind } from '@/server/modules/tracking/schema';
import { FormAlert } from '@/components/forms/form-alert';
import { useSlowPending } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { announce } from '@/lib/announce';
import { dispatchStore, reportProblem } from '@/lib/partner/dispatch';
import { DELIVERY_COPY, PROBLEM_ORDER, problemLabel } from '@/lib/partner/delivery-text';
import { revealDeliveryOutcome } from '@/lib/partner/reveal';

/*
 * "Problem with this delivery" (F8 design 2.8): five rows that send at once. The sheet closes
 * onto the deliver screen, where the outcome stays as a notice with the call buttons inside
 * (or the waiting clock for "isn't answering"). None of them ends the delivery.
 */

const SHEET =
  'inset-x-0 bottom-0 mx-auto max-h-[90dvh] max-w-md overflow-y-auto rounded-t-2xl bg-card px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground data-[state=open]:slide-in-from-bottom-6 motion-reduce:data-[state=open]:slide-in-from-bottom-0';

const ICONS: Record<ProblemKind, LucideIcon> = {
  'no-answer': DoorClosed,
  address: SearchX,
  refused: Ban,
  'cant-finish': TriangleAlert,
  other: CircleHelp,
};

export function ProblemSheet({
  open,
  onOpenChange,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: () => void;
}) {
  const delivery = useSelector(dispatchStore, (state) => state.delivery);
  const offerOpen = useSelector(dispatchStore, (state) => state.card !== null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const [sending, setSending] = useState<ProblemKind | null>(null);
  const [alert, setAlert] = useState<{ text: string; offline: boolean } | null>(null);
  /** A problem went through: the screen shows its outcome once the sheet has closed. */
  const sent = useRef(false);
  const slow = useSlowPending(sending !== null);
  const first = delivery?.dropoff?.firstName ?? 'The customer';

  const send = async (kind: ProblemKind) => {
    if (sending) return;
    setSending(kind);
    setAlert(null);
    const outcome = await reportProblem(kind);
    setSending(null);
    const show = (text: string, offline = false) => {
      setAlert({ text, offline });
      announce(text);
      requestAnimationFrame(() => alertRef.current?.focus());
    };
    if (outcome === 'done' || outcome === 'gone') {
      sent.current = outcome === 'done';
      onOpenChange(false);
      return;
    }
    if (outcome === 'offline') show("You're offline. Nothing was sent.", true);
    else if (outcome === 'limit') show(DELIVERY_COPY.problemLimit);
    else show('Something went wrong. Please try again.');
  };

  return (
    <Sheet
      open={open && !offerOpen && delivery !== null}
      onOpenChange={(next) => {
        if (!next && sending) return;
        if (!next) setAlert(null);
        onOpenChange(next);
      }}
    >
      <SheetContent
        className={SHEET}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!dispatchStore.state.card) returnFocus();
          if (sent.current) {
            sent.current = false;
            revealDeliveryOutcome();
          }
        }}
      >
        <SheetTitle
          ref={titleRef}
          tabIndex={-1}
          className="font-heading text-title-1 text-strong outline-none"
        >
          {DELIVERY_COPY.problemTrigger}
        </SheetTitle>
        <SheetDescription className="sr-only">
          Choose what happened. It is sent to Foodz support at once.
        </SheetDescription>
        <div ref={alertRef} tabIndex={-1} className="outline-none">
          {alert ? (
            <FormAlert
              variant={alert.offline ? 'info' : 'error'}
              tone="partner"
              icon={alert.offline ? WifiOff : undefined}
              className="mt-4"
            >
              {alert.text}
            </FormAlert>
          ) : null}
        </div>
        <ul className="mt-4 space-y-2">
          {PROBLEM_ORDER.map((kind) => {
            const Icon = ICONS[kind];
            const busy = sending === kind;
            return (
              <li key={kind}>
                <button
                  type="button"
                  inert={sending !== null && !busy ? true : undefined}
                  aria-disabled={sending !== null || undefined}
                  onClick={() => void send(kind)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-card px-4 text-left text-body-4 font-medium text-strong hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
                >
                  <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">{problemLabel(kind, first)}</span>
                  {busy && slow ? <Spinner className="size-5" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="dock"
          className="mt-4 bg-card text-strong"
          onClick={() => onOpenChange(false)}
        >
          Close
        </Button>
      </SheetContent>
    </Sheet>
  );
}
