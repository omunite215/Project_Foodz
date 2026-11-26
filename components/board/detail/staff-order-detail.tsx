'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  CircleCheck,
  Clock,
  Phone,
  RotateCcw,
  Undo2,
  UserRoundPlus,
  UserRoundX,
} from 'lucide-react';
import { type ReactNode, type Ref, useEffect, useId, useRef, useState } from 'react';
import {
  moveOrderAction,
  staffOrderDetailAction,
  undoMoveAction,
} from '@/server/modules/board/actions';
import {
  type BoardCard,
  type FullOrderDetail,
  isBoardStatus,
  type MoneyFlag,
  type StaffOrderDetail,
} from '@/server/modules/board/schema';
import { PREVIOUS_STEP } from '@/server/modules/board/state';
import { cardTiming } from '@/server/modules/board/timing';
import { STAFF_STATUS_WORDS } from '@/server/modules/board/text';
import { restartSearchAction } from '@/server/modules/delivery/actions';
import { askToWaitAction } from '@/server/modules/tracking/actions';
import type { StaffCourierSection } from '@/server/modules/delivery/schema';
import { showBoardNotice } from '@/components/admin/board-notices';
import { askedToWaitNotice, firstOfShort } from '@/lib/board/tracking-text';
import { FormAlert } from '@/components/forms/form-alert';
import { BLOCKED_BUTTON_CLASS, useSlowPending } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { type ActionFailure, callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { isOrderChangedDetails, withStatus } from '@/lib/board/model';
import {
  deliveryChangedText,
  isDeliveryChangedDetails,
  LOOKING_AGAIN,
} from '@/lib/board/courier-text';
import {
  actorText,
  boardClock,
  conflictText,
  declineText,
  howItWentLine,
  MENU_WORDS,
  methodLine,
  movedAnnouncement,
  movedBackAnnouncement,
  OFFLINE_CAPTION,
  placedLine,
  PRIMARY_WORDS,
  promisedLine,
  readyByLine,
  READ_ONLY_CAPTION,
  timeBlockText,
  undoSpoken,
} from '@/lib/board/text';
import { type BoardWriter, useBoardCard, useBoardWriter } from '@/lib/data/board';
import { formatPrice } from '@/lib/format';
import { channels } from '@/lib/realtime/channels';
import { useChannelEvent } from '@/lib/realtime/client';
import { useHydrated } from '@/lib/use-hydrated';
import { useOnline } from '@/lib/use-online';
import { cn } from '@/lib/utils';
import {
  DishList,
  FlagChips,
  HiddenForDemo,
  KitchenNote,
  PaymentChip,
  TimeBlock,
} from '../card-parts';
import { CourierSection } from '../courier-parts';
import { stuckFromSteps, TrackingDetail } from './tracking-detail';
import { BoardDialogs, type DialogKind, type DialogState } from '../dialogs/board-dialogs';
import { StaffTimeline } from './staff-timeline';

/*
 * One order in full (F5 design 5): status, time block and payment, the actions the role has,
 * then times, dishes, payment, customer and the whole staff timeline. The same content as a
 * 480 px panel over the live board or as a full page. Refetched on every event for the order.
 */

export const detailKey = (orderId: string) => ['board', 'detail', orderId] as const;

export class DetailNotFound extends Error {}

async function readDetail(orderId: string): Promise<StaffOrderDetail> {
  const outcome = await callAction(() => staffOrderDetailAction({ orderId }));
  if (!outcome.ok) {
    if (outcome.error.code === 'NOT_FOUND') throw new DetailNotFound(outcome.error.message);
    throw new Error(outcome.error.message);
  }
  return outcome.data;
}

/** The detail, refetched on every `private-ops` event for this order (A10.4). */
export function useStaffOrderDetail(
  orderId: string,
  initial?: StaffOrderDetail,
  /** False once the session is over: the subscriptions close (security note S21). */
  live = true,
) {
  const hydrated = useHydrated();
  const listen = hydrated && live;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: detailKey(orderId),
    queryFn: () => readDetail(orderId),
    ...(initial ? { initialData: initial } : {}),
    staleTime: 0,
    retry: (count, error) => !(error instanceof DetailNotFound) && count < 1,
  });
  const refetch = () => void queryClient.invalidateQueries({ queryKey: detailKey(orderId) });
  useChannelEvent(listen ? channels.ops : null, 'order.board-changed', (event) => {
    if (event.orderId === orderId) refetch();
  });
  useChannelEvent(listen ? channels.order(orderId) : null, 'order.status-changed', () => refetch());
  // F7 (A36): the courier section follows every change of the order's delivery.
  useChannelEvent(listen ? channels.ops : null, 'delivery.changed', (event) => {
    if (event.orderId === orderId) refetch();
  });
  return query;
}

const FLAGS_OF = (money: FullOrderDetail['money']): MoneyFlag[] => [
  ...(money.paymentStatus === 'REFUNDED' ? (['refunded'] as const) : []),
  ...(money.paymentStatus === 'PARTIALLY_REFUNDED' ? (['partlyRefunded'] as const) : []),
  ...(money.dispute.status === 'OPEN' ? (['disputed'] as const) : []),
  ...(money.paidLate ? (['paidLate'] as const) : []),
];

/** The detail in the board card's shape, for the dialogs and the time block. */
export function detailAsCard(detail: StaffOrderDetail): BoardCard | null {
  if (!isBoardStatus(detail.status)) return null;
  const base = {
    id: detail.id,
    number: detail.number,
    status: detail.status,
    version: detail.version,
    placedAt: detail.placedAt ?? detail.createdAt,
    acceptedAt: detail.acceptedAt,
    preparingAt: detail.preparingAt,
    readyAt: detail.readyAt,
    pickedUpAt: detail.pickedUpAt,
    readyBy: detail.readyBy,
    firstName: detail.customer.firstName,
    itemCount: detail.lines.reduce((sum, line) => sum + line.quantity, 0),
    kitchenNote: detail.kitchenNote,
    undo: detail.actions.undo,
    masked: { firstName: detail.masked.customer, kitchenNote: detail.masked.kitchenNote },
    // F7: the courier line, so the dialogs know who holds the order (design 2.11).
    courier: detail.courierSection?.courier ?? null,
  };
  if (detail.view === 'kitchen') {
    return { ...base, view: 'kitchen', lines: detail.lines, payment: detail.payment };
  }
  return {
    ...base,
    view: 'full',
    lines: detail.lines,
    payment: {
      method: detail.money.method,
      status: detail.money.paymentStatus,
      totalCents: detail.money.totalCents,
      refundedCents: detail.money.refundedCents,
      dispute: detail.money.dispute.status,
      paidLate: detail.money.paidLate,
      flags: FLAGS_OF(detail.money),
    },
  };
}

function StatusChip({ status }: { status: StaffOrderDetail['status'] }) {
  return (
    <span
      data-detail-status=""
      tabIndex={-1}
      className="inline-flex h-7 outline-offset-2 items-center rounded-md bg-neutral-7 px-2.5 text-body-5 font-medium whitespace-nowrap text-neutral-1"
    >
      {STAFF_STATUS_WORDS[status]}
    </span>
  );
}

function Section({
  title,
  level,
  children,
}: {
  title: string;
  level: 'h2' | 'h3';
  children: ReactNode;
}) {
  const id = useId();
  const Heading = level;
  return (
    <section aria-labelledby={id}>
      <Heading id={id} className="text-body-3 font-semibold text-neutral-1">
        {title}
      </Heading>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 text-body-4 tabular-nums',
        strong ? 'font-semibold text-neutral-1' : 'text-neutral-2',
      )}
    >
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PaymentSection({
  detail,
  level,
  timeZone,
}: {
  detail: FullOrderDetail;
  level: 'h2' | 'h3';
  timeZone: string;
}) {
  const money = detail.money;
  return (
    <Section title="Payment" level={level}>
      <dl className="space-y-1.5">
        {detail.lines.map((line) => (
          <Row
            key={line.id}
            label={`${line.quantity} × ${line.title}`}
            value={formatPrice(line.lineTotalCents)}
          />
        ))}
        <Row label="Subtotal" value={formatPrice(money.subtotalCents)} />
        {money.promo ? (
          <Row
            label={money.promo.code ? `Promo · ${money.promo.code}` : 'Promo'}
            value={`−${formatPrice(money.promo.foodDiscountCents)}`}
          />
        ) : null}
        <Row
          label={`Delivery · ${detail.customer.distanceKm.toFixed(1)} km`}
          value={formatPrice(money.deliveryFeeCents - money.deliveryDiscountCents)}
        />
        <Row
          label={money.taxRateBps !== null ? `Tax (${money.taxRateBps / 100}%)` : 'Tax'}
          value={formatPrice(money.taxCents)}
        />
        {money.tipCents > 0 ? <Row label="Tip" value={formatPrice(money.tipCents)} /> : null}
        <Row label="Total" value={formatPrice(money.totalCents)} strong />
      </dl>
      <p className="mt-3 text-body-4 text-neutral-1">{methodLine(money)}</p>
      {money.refund.state === 'pending' && money.refund.amountCents !== null ? (
        <p className="mt-2 flex items-center gap-2 text-body-4 text-neutral-1">
          <Clock className="size-4 text-neutral-3" aria-hidden />
          Refund of {formatPrice(money.refund.amountCents)} pending
        </p>
      ) : null}
      {money.refund.state === 'done' && money.refund.amountCents !== null ? (
        <p className="mt-2 flex items-center gap-2 text-body-4 text-neutral-1">
          <CircleCheck className="size-4 text-brand-strong" aria-hidden />
          Refunded {formatPrice(money.refund.amountCents)} to {money.cardLabel ?? 'the card'}
          {money.refund.since ? ` · ${boardClock(money.refund.since, timeZone)}` : ''}
        </p>
      ) : null}
      {money.refund.state === 'slow' ? (
        <FormAlert variant="warning" className="mt-3">
          This refund hasn&apos;t gone through yet. We keep trying; if it stays like this, refund it
          in the Stripe dashboard.
        </FormAlert>
      ) : null}
      {money.refund.state === 'sample' ? (
        <p className="mt-2 text-body-4 text-neutral-1">
          Sample order: there&apos;s no card payment to refund.
        </p>
      ) : null}
      {money.decline ? (
        <p className="mt-2 text-body-4 text-neutral-1">{declineText(money.decline)}</p>
      ) : null}
      {money.dispute.status !== 'NONE' ? (
        <p className="mt-2 text-body-4 text-neutral-1">
          Dispute: {money.dispute.status.toLowerCase()}
        </p>
      ) : null}
    </Section>
  );
}

function CustomerSection({ detail, level }: { detail: FullOrderDetail; level: 'h2' | 'h3' }) {
  const customer = detail.customer;
  const address = [customer.address.line1, customer.address.city].filter(Boolean).join(', ');
  return (
    <Section title="Customer" level={level}>
      <p className="text-body-4 font-medium text-neutral-1 [overflow-wrap:anywhere]">
        {customer.name}
      </p>
      {customer.phone ? (
        <a
          href={`tel:${customer.phone}`}
          aria-label={`Call ${customer.name}, ${customer.phoneDisplay}`}
          className="inline-flex h-11 items-center gap-2 text-body-4 text-neutral-1 underline underline-offset-4"
        >
          <Phone className="size-4" aria-hidden />
          {customer.phoneDisplay}
        </a>
      ) : (
        <p className="text-body-4 text-neutral-1">{customer.phoneDisplay}</p>
      )}
      <p className="text-body-4 text-neutral-1 [overflow-wrap:anywhere]">{address}</p>
      {customer.address.line2 ? (
        <p className="text-body-4 text-neutral-1 [overflow-wrap:anywhere]">
          {customer.address.line2}
        </p>
      ) : null}
      {customer.instructions ? (
        <p className="text-body-4 text-neutral-1 [overflow-wrap:anywhere]">
          <span className="sr-only">Courier instructions: </span>
          {customer.instructions}
        </p>
      ) : null}
      <p className="text-body-5 text-neutral-3">{customer.distanceKm.toFixed(1)} km away</p>
      {detail.masked.customer ? <HiddenForDemo /> : null}
    </Section>
  );
}

// ------------------------------------------------------------------ actions (design 5.2)

function DetailButton({
  children,
  pending,
  pendingLabel = 'Moving…',
  blocked,
  captionId,
  primary,
  destructive,
  onPress,
}: {
  children: ReactNode;
  pending?: boolean;
  pendingLabel?: string;
  blocked: boolean;
  captionId: string;
  primary?: boolean;
  destructive?: boolean;
  onPress: () => void;
}) {
  const slow = useSlowPending(Boolean(pending));
  return (
    <Button
      type="button"
      size="kitchen"
      variant={primary ? 'default' : 'outline'}
      aria-disabled={blocked || pending ? true : undefined}
      aria-describedby={blocked ? captionId : undefined}
      onClick={() => {
        if (pending) return;
        if (blocked) {
          announce(document.getElementById(captionId)?.textContent ?? '');
          return;
        }
        onPress();
      }}
      className={cn(
        primary && 'w-full font-semibold',
        destructive &&
          'border-destructive text-destructive hover:bg-tag-4-bg hover:text-destructive',
        blocked && !pending && BLOCKED_BUTTON_CLASS,
      )}
    >
      {slow ? (
        <>
          <Spinner className="motion-reduce:animate-none" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

function DetailActions({
  detail,
  offline,
  writer,
  onDialog,
  onRefresh,
  onSignedOut,
  timeZone,
}: {
  detail: StaffOrderDetail;
  offline: boolean;
  writer: BoardWriter;
  onDialog: (kind: DialogKind) => void;
  onRefresh: () => void;
  onSignedOut: () => void;
  timeZone: string;
}) {
  const captionId = useId();
  const [pending, setPending] = useState<'move' | 'undo' | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const actions = detail.actions;
  const blocked = actions.readOnly || offline;
  const caption = actions.readOnly ? READ_ONLY_CAPTION : offline ? OFFLINE_CAPTION : null;
  const card = detailAsCard(detail);

  const fail = (failure: ActionFailure) => {
    if (failure.code === 'UNAUTHENTICATED') {
      onSignedOut();
      return;
    }
    const text =
      failure.code === 'ORDER_CHANGED' && isOrderChangedDetails(failure.details)
        ? conflictText(failure.details, null, timeZone)
        : failure.message;
    setReason(text);
    showBoardNotice(text);
    onRefresh();
  };

  const move = async () => {
    if (!actions.next || !card) return;
    const to = actions.next;
    setPending('move');
    setReason(null);
    const outcome = await callAction(() =>
      moveOrderAction({ orderId: detail.id, to, expectedVersion: detail.version }),
    );
    setPending(null);
    if (!outcome.ok) {
      fail(outcome.error);
      return;
    }
    const result = outcome.data;
    if (writer.card(detail.id)) {
      writer.put({
        ...withStatus(card, result.status, result.version, result.at),
        undo: { eventId: result.eventId, type: result.status, until: result.undoUntil },
      });
    }
    announce(movedAnnouncement(detail.number, result.status));
    onRefresh();
  };

  const undo = async () => {
    if (!actions.undo || !card) return;
    const eventId = actions.undo.eventId;
    setPending('undo');
    setReason(null);
    const outcome = await callAction(() => undoMoveAction({ orderId: detail.id, eventId }));
    setPending(null);
    if (!outcome.ok) {
      fail(outcome.error);
      return;
    }
    const result = outcome.data;
    if (writer.card(detail.id) && isBoardStatus(result.status)) {
      writer.put(withStatus(card, result.status, result.version, result.at));
    }
    announce(movedBackAnnouncement(detail.number, result.status));
    onRefresh();
  };

  const secondary: { kind: DialogKind; label: string; icon?: ReactNode; destructive?: boolean }[] =
    [
      ...(actions.moveBack
        ? [
            {
              kind: 'moveBack' as const,
              label: MENU_WORDS.moveBack,
              icon: <Undo2 className="size-5" aria-hidden />,
            },
          ]
        : []),
      ...(actions.pickUp ? [{ kind: 'pickUp' as const, label: MENU_WORDS.pickUp }] : []),
      ...(actions.deliver ? [{ kind: 'deliver' as const, label: MENU_WORDS.deliver }] : []),
      ...(actions.refuse
        ? [{ kind: 'refuse' as const, label: MENU_WORDS.refuse, destructive: true }]
        : []),
      ...(actions.cancel
        ? [
            // No icon, as "Can't make it": the red outline carries it (5.2).
            { kind: 'cancel' as const, label: MENU_WORDS.cancel, destructive: true },
          ]
        : []),
    ];
  const nothing = !actions.next && !actions.undo && secondary.length === 0;
  if (nothing) return null;

  return (
    <div className="mt-4 space-y-2">
      {actions.undo ? (
        <DetailButton
          primary
          pending={pending === 'undo'}
          blocked={blocked}
          captionId={captionId}
          onPress={() => void undo()}
        >
          Undo
          <span className="sr-only">
            , {undoSpoken(detail.number, PREVIOUS_STEP[detail.status] ?? detail.status)}
          </span>
        </DetailButton>
      ) : actions.next ? (
        <DetailButton
          primary
          pending={pending === 'move'}
          blocked={blocked}
          captionId={captionId}
          onPress={() => void move()}
        >
          {PRIMARY_WORDS[actions.next]}
          <span className="sr-only"> order {detail.number}</span>
        </DetailButton>
      ) : null}
      {secondary.length ? (
        <div className="flex flex-wrap gap-2">
          {secondary.map((item) => (
            <DetailButton
              key={item.kind}
              blocked={blocked}
              captionId={captionId}
              destructive={item.destructive}
              onPress={() => onDialog(item.kind)}
            >
              {item.icon}
              {item.label}
            </DetailButton>
          ))}
        </div>
      ) : null}
      {caption ? (
        <p id={captionId} className="text-caption text-neutral-3">
          {caption}
        </p>
      ) : null}
      {reason ? (
        <p className="rounded-lg bg-neutral-7 px-3 py-2 text-body-5 text-neutral-1">{reason}</p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ the courier's actions (2.6, 2.10)

function CourierActions({
  section,
  detail,
  offline,
  onDialog,
  onRefresh,
  onSignedOut,
  timeZone,
}: {
  section: Extract<StaffCourierSection, { view: 'full' }>;
  detail: StaffOrderDetail;
  offline: boolean;
  onDialog: (kind: DialogKind) => void;
  onRefresh: () => void;
  onSignedOut: () => void;
  timeZone: string;
}) {
  const captionId = useId();
  const [starting, setStarting] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const actions = section.actions;
  const readOnly = actions.readOnly;
  const blocked = readOnly || offline;
  const caption = readOnly ? READ_ONLY_CAPTION : offline ? OFFLINE_CAPTION : null;
  // The demo admin sees the actions the role would have, disabled (design 2.6).
  const held = section.assigned !== null && !actions.afterPickup;
  const ready = detail.status === 'READY';
  const showAssign = actions.assign || (readOnly && ready && !held);
  const showTakeOff = actions.takeOff || (readOnly && ready && held);
  const showFind = actions.findCourier || (readOnly && section.courier.state === 'notLooking');
  if (!showAssign && !showTakeOff && !showFind) return null;

  const findCourier = async () => {
    setStarting(true);
    setReason(null);
    const outcome = await callAction(() =>
      restartSearchAction({ orderId: detail.id, expectedVersion: section.deliveryVersion ?? 0 }),
    );
    setStarting(false);
    if (outcome.ok) {
      showBoardNotice(LOOKING_AGAIN);
      onRefresh();
      return;
    }
    if (outcome.error.code === 'UNAUTHENTICATED') {
      onSignedOut();
      return;
    }
    const text =
      outcome.error.code === 'DELIVERY_CHANGED' && isDeliveryChangedDetails(outcome.error.details)
        ? deliveryChangedText(detail.number, outcome.error.details, timeZone, outcome.error.message)
        : outcome.error.message;
    setReason(text);
    announce(text);
    onRefresh();
  };

  return (
    <div className="mt-4 space-y-2">
      <div className="flex flex-wrap gap-2">
        {showAssign ? (
          <DetailButton
            blocked={blocked}
            captionId={captionId}
            onPress={() => onDialog('assignCourier')}
          >
            <UserRoundPlus className="size-5" aria-hidden />
            Assign courier
          </DetailButton>
        ) : null}
        {showTakeOff ? (
          <>
            <DetailButton
              blocked={blocked}
              captionId={captionId}
              onPress={() => onDialog('takeOffCourier')}
            >
              <UserRoundX className="size-5" aria-hidden />
              Take off courier
            </DetailButton>
            <DetailButton
              blocked={blocked}
              captionId={captionId}
              onPress={() => onDialog('chooseAnother')}
            >
              <ArrowLeftRight className="size-5" aria-hidden />
              Choose another courier
            </DetailButton>
          </>
        ) : null}
        {showFind ? (
          <DetailButton
            blocked={blocked}
            pending={starting}
            pendingLabel="Starting…"
            captionId={captionId}
            onPress={() => void findCourier()}
          >
            <RotateCcw className="size-5" aria-hidden />
            Find a courier
          </DetailButton>
        ) : null}
      </div>
      {caption ? (
        <p id={captionId} className="text-caption text-neutral-3">
          {caption}
        </p>
      ) : null}
      {reason ? (
        <p className="rounded-lg bg-neutral-7 px-3 py-2 text-body-5 text-neutral-1">{reason}</p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ the view

export function StaffOrderDetailView({
  detail,
  variant,
  timeZone,
  titleRef,
  closeButton,
  onSignedOut,
}: {
  detail: StaffOrderDetail;
  variant: 'panel' | 'page';
  timeZone: string;
  titleRef?: Ref<HTMLHeadingElement>;
  closeButton?: ReactNode;
  onSignedOut: () => void;
}) {
  const queryClient = useQueryClient();
  const writer = useBoardWriter();
  const online = useOnline();
  const liveCard = useBoardCard(detail.id);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const level = variant === 'panel' ? 'h3' : 'h2';
  const now = useDetailClock(detail.asOf);
  const courierNow = useDetailClock(detail.asOf, 5_000);
  const card = detailAsCard(detail);
  const time = card ? timeBlockText(cardTiming(card, now), card, timeZone) : null;
  const cancelledText = useCancelledNotice(detail);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: detailKey(detail.id) });
  // F8 (A50): "Ask to wait" acts at once from the detail too.
  const [asking, setAsking] = useState(false);
  const askToWait = async () => {
    if (!card || asking) return;
    setAsking(true);
    const outcome = await callAction(() =>
      askToWaitAction({
        orderId: detail.id,
        expectedVersion: card.courier?.deliveryVersion ?? 0,
      }),
    );
    setAsking(false);
    if (outcome.ok) {
      showBoardNotice(
        askedToWaitNotice(
          card.courier?.shortName ?? 'the courier',
          card.masked.firstName ? null : card.firstName,
        ),
      );
      refresh();
      return;
    }
    if (outcome.error.code === 'UNAUTHENTICATED') {
      onSignedOut();
      return;
    }
    showBoardNotice(outcome.error.message, { variant: 'error' });
    refresh();
  };
  const openStuckDialog = (kind: 'confirmHandover' | 'cancelUnreachable') => {
    if (!card) return;
    const opener = document.activeElement;
    setDialog({
      kind,
      cardId: card.id,
      card,
      opener: opener instanceof HTMLElement ? opener : null,
    });
  };
  const howItWent = howItWentLine(detail.howItWent);

  return (
    <>
      <header
        className={cn(
          'border-b border-neutral-6 bg-white px-6 pt-5 pb-4',
          variant === 'panel' && 'sticky top-0 z-10',
        )}
      >
        {variant === 'panel' ? (
          <div className="flex items-start justify-between gap-3">
            <SheetTitle
              ref={titleRef}
              tabIndex={-1}
              className="font-heading text-title-1 text-neutral-2 tabular-nums outline-none"
            >
              Order {detail.number}
            </SheetTitle>
            {closeButton}
          </div>
        ) : null}
        <div className={cn('flex flex-wrap gap-2', variant === 'panel' && 'mt-2')}>
          <StatusChip status={detail.status} />
          {time ? <TimeBlock text={time} /> : null}
          {card ? <PaymentChip payment={card.payment} /> : null}
          {card ? <FlagChips card={card} /> : null}
        </div>
        {cancelledText ? (
          <FormAlert variant="info" className="mt-4">
            {cancelledText}
          </FormAlert>
        ) : (
          <DetailActions
            detail={detail}
            offline={!online}
            writer={writer}
            timeZone={timeZone}
            onRefresh={refresh}
            onSignedOut={onSignedOut}
            onDialog={(kind) => {
              if (!card) return;
              const opener = document.activeElement;
              setDialog({
                kind,
                cardId: card.id,
                card,
                opener: opener instanceof HTMLElement ? opener : null,
              });
            }}
          />
        )}
      </header>
      <div className="space-y-6 px-6 py-5">
        {detail.courierSection ? (
          <CourierSection
            section={detail.courierSection}
            orderNumber={detail.number}
            orderStatus={detail.status}
            now={courierNow}
            timeZone={timeZone}
            level={level}
            deliveryLine={
              detail.courierSection.view === 'full' && !cancelledText
                ? (detail.tracking?.line ?? null)
                : null
            }
            tracking={
              detail.tracking && detail.courierSection.view === 'full' ? (
                <TrackingDetail
                  tracking={detail.tracking}
                  orderNumber={detail.number}
                  courierName={detail.courierSection.assigned?.name ?? null}
                  courierId={detail.courierSection.assigned?.partnerId ?? null}
                  courierFirst={firstOfShort(detail.courierSection.courier.shortName)}
                  timeZone={timeZone}
                  serverNowMs={courierNow.getTime()}
                  level={level === 'h2' ? 'h3' : 'h4'}
                  stuck={
                    cancelledText || detail.status !== 'PICKED_UP'
                      ? []
                      : stuckFromSteps(detail.tracking.steps, courierNow.getTime())
                  }
                  readOnly={detail.courierSection.actions.readOnly}
                  offline={!online}
                  asking={asking}
                  onStuck={(item) => {
                    if (item === 'askToWait') void askToWait();
                    else openStuckDialog(item);
                  }}
                />
              ) : null
            }
            actions={
              detail.courierSection.view === 'full' && !cancelledText ? (
                <CourierActions
                  section={detail.courierSection}
                  detail={detail}
                  offline={!online}
                  timeZone={timeZone}
                  onRefresh={refresh}
                  onSignedOut={onSignedOut}
                  onDialog={(kind) => {
                    if (!card) return;
                    const opener = document.activeElement;
                    setDialog({
                      kind,
                      cardId: card.id,
                      card,
                      opener: opener instanceof HTMLElement ? opener : null,
                    });
                  }}
                />
              ) : null
            }
          />
        ) : null}
        <Section title="Times" level={level}>
          <ul className="space-y-1 text-body-4 text-neutral-1 tabular-nums">
            {detail.placedAt ? <li>{placedLine(detail.placedAt, now, timeZone)}</li> : null}
            {detail.readyBy ? <li>{readyByLine(detail.readyBy, now, timeZone)}</li> : null}
            {detail.promised ? (
              <li>{promisedLine(detail.promised.from, detail.promised.to, timeZone, now)}</li>
            ) : null}
            {howItWent ? <li className="text-neutral-3">{howItWent}</li> : null}
          </ul>
        </Section>
        <Section title="Dishes" level={level}>
          <DishList lines={detail.lines} showSoldOut={false} />
          <KitchenNote
            note={detail.kitchenNote}
            masked={detail.masked.kitchenNote}
            className="mt-3"
          />
        </Section>
        {detail.view === 'full' ? (
          <PaymentSection detail={detail} level={level} timeZone={timeZone} />
        ) : null}
        {detail.view === 'full' ? <CustomerSection detail={detail} level={level} /> : null}
        <StaffTimeline
          entries={detail.timeline}
          now={now}
          timeZone={timeZone}
          headingLevel={level}
        />
      </div>
      {card ? (
        <BoardDialogs
          dialog={dialog}
          current={liveCard ?? (dialog ? card : null)}
          can={{
            move: Boolean(detail.actions.next),
            undo: Boolean(detail.actions.undo),
            moveBack: Boolean(detail.actions.moveBack),
            refuse: detail.actions.refuse,
            cancel: Boolean(detail.actions.cancel),
            handOver: detail.actions.pickUp || Boolean(detail.actions.deliver),
            // KITCHEN and ADMIN may mark dishes sold out; SUPPORT may not (contract §1).
            setAvailability:
              detail.view === 'kitchen' ||
              Boolean(
                detail.actions.next ||
                detail.actions.moveBack ||
                detail.actions.pickUp ||
                detail.actions.deliver,
              ),
            readOnly: detail.actions.readOnly,
          }}
          timeZone={timeZone}
          offline={!online}
          writer={writer}
          onSignedOut={onSignedOut}
          onClose={() => {
            setDialog(null);
            refresh();
          }}
          onChain={(kind) => setDialog((current) => (current ? { ...current, kind } : current))}
          focusAfter={() => {
            // From the detail: focus to its status line (design 3.3).
            requestAnimationFrame(() =>
              document.querySelector<HTMLElement>('[data-detail-status]')?.focus(),
            );
          }}
        />
      ) : null}
    </>
  );
}

/** The server's time for the detail's timers (B14): `asOf`, then ticking every 15 seconds. */
function useDetailClock(asOf: string, every = 15_000): Date {
  const [base] = useState(() => ({ asOf, receivedAt: Date.now() }));
  const [now, setNow] = useState(() => new Date(asOf));
  useEffect(() => {
    const offset = Date.parse(base.asOf) - base.receivedAt;
    const tick = () => setNow(new Date(Date.now() + offset));
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, every);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [base, every]);
  return now;
}

/** "Order 1043 was cancelled by Morgan Diaz (Support)." once cancelled (design 5.4). */
function useCancelledNotice(detail: StaffOrderDetail): string | null {
  const wasCancelled = useRef(detail.status === 'CANCELLED');
  const text =
    detail.status === 'CANCELLED' && detail.cancellation
      ? `Order ${detail.number} was cancelled by ${actorText(detail.cancellation.by)}.`
      : null;
  useEffect(() => {
    if (text && !wasCancelled.current) announce(text);
    wasCancelled.current = Boolean(text);
  }, [text]);
  return text;
}
