'use client';

import { Check, CircleAlert, Info, Lock, ShieldCheck, Soup, SquarePen, Star } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { rateOrderAction, skipRatingAction } from '@/server/modules/ratings/actions';
import type {
  OrderRatingView,
  RateOrderInput,
  RatingCourierRow,
  RatingDishRow,
  Stars,
} from '@/server/modules/ratings/schema';
import { DishPlate } from '@/components/dish/dish-plate';
import { FormAlert } from '@/components/forms/form-alert';
import { SubmitButton } from '@/components/forms/submit-button';
import {
  CommentField,
  RatingRowFrame,
  StarInput,
  StarWord,
  TagToggles,
} from '@/components/ratings/rating-fields';
import { StarsDisplay } from '@/components/ratings/stars-display';
import { Button } from '@/components/ui/button';
import { type ActionOutcome, callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { prefersReducedMotion, useMotion } from '@/lib/motion';
import {
  cardHeading,
  closedLine,
  courierHeading,
  courierPrivacy,
  dishName,
  draftChanged,
  draftFrom,
  editUntilLine,
  keepTags,
  RATING_COPY,
  type RatingDraft,
  type RatingSubject,
  ratingRequest,
  type RowDraft,
  sendRefusal,
  summaryListName,
  thanksLine,
} from '@/lib/rating-text';
import { useOnline } from '@/lib/use-online';

/*
 * "How was order 1042?" (F9 design 2): one card under the hero of a delivered order, above the
 * status card, so its heading and the first dish's stars fit at 375 × 667. Stars per dish and
 * for the courier, optional tags and a private comment; then a summary she can edit for 7 days.
 * Everything she sees comes from the server's `OrderRatingView`; the page only keeps her picks.
 * Delivered while the page is open, the card rises in (S1.1); later swaps cross-fade.
 */

/** How the card reaches the server; stories pass their own. */
export interface RatingClient {
  rate: (input: RateOrderInput) => Promise<ActionOutcome<OrderRatingView>>;
  skip: (orderId: string) => Promise<ActionOutcome<OrderRatingView>>;
}

const ACTIONS: RatingClient = {
  rate: (input) => callAction(() => rateOrderAction(input)),
  skip: (orderId) => callAction(() => skipRatingAction({ orderId })),
};

const EMPTY_ROW: RowDraft = { stars: null, tags: [], comment: '', commentOpen: false };
const CARD =
  'mt-6 scroll-mt-6 rounded-2xl border border-neutral-6 bg-white p-5 focus:outline-none md:p-6';

type FocusTarget = 'heading' | 'summary' | 'rateButton' | 'editButton' | 'closed' | 'firstStar';

function CourierAvatar({ firstName, photoUrl }: { firstName: string; photoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  const initial = Array.from(firstName.trim())[0]?.toUpperCase() ?? '';
  return (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft">
      {photoUrl && !failed ? (
        // A short-lived private link, drawn as is (F7's courier block does the same).
        // oxlint-disable-next-line nextjs/no-img-element
        <img
          src={photoUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <span aria-hidden className="font-heading text-title-2 text-brand-strong">
          {initial}
        </span>
      )}
    </span>
  );
}

function useRowFields({
  idBase,
  rowKey,
  kind,
  subject,
  row,
  demo,
  showError,
  onChange,
}: {
  /** The card's own id, so two cards on one screen never share ids or radio groups. */
  idBase: string;
  rowKey: string;
  kind: 'dish' | 'courier';
  subject: RatingSubject;
  row: RowDraft;
  demo: boolean;
  /** The empty-send line's id, while it shows. */
  showError: string | null;
  onChange: (next: RowDraft) => void;
}) {
  // Tags rise in only after her own pick on this visit.
  const [pickedHere, setPickedHere] = useState(false);
  const id = `${idBase}-${kind}-${rowKey}`;
  return {
    stars: (
      <StarInput
        name={`${idBase}-rate-${rowKey}`}
        subject={subject}
        value={row.stars}
        describedBy={showError ?? undefined}
        onChange={(stars: Stars) => {
          setPickedHere(true);
          onChange({ ...row, stars, tags: keepTags(kind, stars, row.tags) });
        }}
      />
    ),
    word: <StarWord stars={row.stars} />,
    extra: (
      <>
        {row.stars ? (
          <TagToggles
            id={id}
            kind={kind}
            stars={row.stars}
            pressed={row.tags}
            animateIn={pickedHere}
            onToggle={(tag) =>
              onChange({
                ...row,
                tags: row.tags.includes(tag)
                  ? row.tags.filter((item) => item !== tag)
                  : [...row.tags, tag],
              })
            }
          />
        ) : null}
        {demo ? null : (
          <CommentField
            id={id}
            subject={subject}
            open={row.commentOpen}
            value={row.comment}
            onOpen={() => onChange({ ...row, commentOpen: true })}
            onChange={(comment) => onChange({ ...row, comment })}
          />
        )}
      </>
    ),
  };
}

function DishRow(props: {
  idBase: string;
  dish: RatingDishRow;
  row: RowDraft;
  demo: boolean;
  showError: string | null;
  onChange: (next: RowDraft) => void;
}) {
  const { idBase, dish, row, demo, showError, onChange } = props;
  const fields = useRowFields({
    idBase,
    rowKey: dish.menuItemId,
    kind: 'dish',
    subject: { kind: 'dish', title: dish.title },
    row,
    demo,
    showError,
    onChange,
  });
  return (
    <RatingRowFrame
      media={
        dish.imageUrl ? (
          <DishPlate src={dish.imageUrl} sizes="48px" className="size-12 rounded-lg" />
        ) : (
          // Design 2.4: a 48 px rounded square, the same slot as a photo (review P10).
          <span
            aria-hidden
            className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-neutral-7"
          >
            <Soup className="size-6 text-neutral-4" strokeWidth={1.5} />
          </span>
        )
      }
      name={dishName(dish.title, dish.quantity)}
      word={fields.word}
      stars={fields.stars}
    >
      {fields.extra}
    </RatingRowFrame>
  );
}

function CourierRow(props: {
  idBase: string;
  courier: RatingCourierRow;
  photoUrl: string | null;
  row: RowDraft;
  demo: boolean;
  showError: string | null;
  onChange: (next: RowDraft) => void;
}) {
  const { idBase, courier, photoUrl, row, demo, showError, onChange } = props;
  const fields = useRowFields({
    idBase,
    rowKey: 'courier',
    kind: 'courier',
    subject: { kind: 'courier', firstName: courier.firstName },
    row,
    demo,
    showError,
    onChange,
  });
  return (
    <RatingRowFrame
      as="div"
      media={<CourierAvatar firstName={courier.firstName} photoUrl={photoUrl} />}
      name={courier.firstName}
      word={fields.word}
      stars={fields.stars}
    >
      {fields.extra}
    </RatingRowFrame>
  );
}

export function RatingCard({
  orderId,
  orderNumber,
  rating,
  customerFirst,
  courierPhotoUrl = null,
  onChange,
  client = ACTIONS,
}: {
  orderId: string;
  orderNumber: string;
  rating: OrderRatingView | null | undefined;
  /** "Thanks, Priya." */
  customerFirst: string | null;
  /** The courier's photo while the page still has one; the initial otherwise. */
  courierPhotoUrl?: string | null;
  /** The server's answer after a send or a skip: the page keeps it as the order's card. */
  onChange: (next: OrderRatingView) => void;
  client?: RatingClient;
}) {
  const online = useOnline();
  const idBase = `rate${useId().replaceAll(/[^\w-]/g, '')}`;
  const headingId = `${idBase}-title`;
  const errorId = `${idBase}-error`;
  const courierHeadingId = `${idBase}-courier`;
  const offlineId = `${idBase}-offline`;
  const [draft, setDraft] = useState<RatingDraft>(() =>
    rating ? draftFrom(rating) : { dishes: {}, courier: null },
  );
  const [editing, setEditing] = useState(false);
  const [thanked, setThanked] = useState(false);
  const [closedNow, setClosedNow] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState<'send' | 'skip' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<FocusTarget | null>(null);
  const sending = useRef(false);

  const state = rating?.state ?? 'none';
  const rated = state === 'rated';
  const editable = Boolean(rating?.editable) && closedNow === null;
  const mode: 'none' | 'form' | 'summary' | 'skipped' | 'closedLine' =
    !rating || state === 'none'
      ? 'none'
      : closedNow !== null && !rated
        ? 'closedLine'
        : state === 'closed'
          ? 'none'
          : rated
            ? editing && editable
              ? 'form'
              : 'summary'
            : state === 'skipped' && !editing
              ? 'skipped'
              : 'form';
  const isEdit = mode === 'form' && rated;

  // Focus lands on whatever replaced the control she pressed (design, Focus).
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const root = rootRef.current;
    const element =
      target === 'firstStar'
        ? root?.querySelector<HTMLElement>('input[type="radio"]')
        : root?.querySelector<HTMLElement>(`[data-focus="${target}"]`);
    element?.focus();
  });

  // Arriving with #rate (the reminder, "Rate" on the Orders list): the card comes into view and
  // its heading takes focus (S4.3, S6.1).
  useEffect(() => {
    if (window.location.hash !== '#rate') return;
    const heading = rootRef.current?.querySelector<HTMLElement>('[data-focus]');
    if (!heading) return;
    // The card itself comes into view, with its scroll-mt-6 margin above it (review P8).
    (rootRef.current?.querySelector<HTMLElement>('#rate') ?? heading).scrollIntoView({
      behavior: prefersReducedMotion() ? 'instant' : 'smooth',
      block: 'start',
    });
    heading.focus({ preventScroll: true });
  }, []);

  // The card rises in when the order is delivered while the page is open; later swaps
  // (form to summary, to "Rate this order") cross-fade.
  // In the first HTML it's simply there.
  const [swap, setSwap] = useState({ count: 0, mode, from: mode });
  if (swap.mode !== mode) setSwap({ count: swap.count + 1, mode, from: swap.mode });
  useMotion(
    (motion) => {
      const root = rootRef.current?.firstElementChild;
      if (!root || swap.count === 0 || swap.mode === 'none') return;
      if (swap.from === 'none') {
        motion.from(root, {
          y: 8,
          opacity: 0,
          duration: motion.reduced ? 0.12 : 0.2,
          ease: 'power2.out',
        });
        return;
      }
      motion.from(root, {
        opacity: 0,
        duration: swap.mode === 'skipped' ? 0.15 : 0.2,
        ease: 'power2.out',
      });
    },
    { scope: rootRef, dependencies: [swap.count] },
  );

  if (!rating || mode === 'none') return null;

  const courierFirst = rating.courier?.firstName ?? null;
  const rowOf = (key: string) => draft.dishes[key] ?? EMPTY_ROW;
  const setRow = (key: string, next: RowDraft) => {
    if (next.stars) setEmpty(false);
    setDraft((current) => ({ ...current, dishes: { ...current.dishes, [key]: next } }));
  };
  const setCourier = (next: RowDraft) => {
    if (next.stars) setEmpty(false);
    setDraft((current) => ({ ...current, courier: next }));
  };

  function openForm() {
    if (!rating) return;
    setDraft(draftFrom(rating));
    setEmpty(false);
    setAlert(null);
    setThanked(false);
    setEditing(true);
    focusNext.current = 'heading';
  }

  async function send() {
    if (!rating || sending.current) return;
    if (!online) {
      announce(RATING_COPY.offline);
      return;
    }
    if (isEdit && !draftChanged(rating, draft)) {
      // Nothing new: back to the summary without a request (2.8).
      setEditing(false);
      focusNext.current = 'editButton';
      return;
    }
    const request = ratingRequest(orderId, rating, draft);
    if (!request) {
      setEmpty(true);
      setAlert(null);
      focusNext.current = 'firstStar';
      return;
    }
    sending.current = true;
    setEmpty(false);
    setAlert(null);
    setPending('send');
    const outcome = await client.rate(request);
    sending.current = false;
    setPending(null);
    if (outcome.ok) {
      onChange(outcome.data);
      setEditing(false);
      setThanked(!isEdit);
      announce(isEdit ? RATING_COPY.changesSaved : thanksLine(customerFirst, courierFirst));
      focusNext.current = 'summary';
      return;
    }
    const refusal = sendRefusal(outcome.error, rating.closedOnWords);
    if (refusal.kind === 'closed') {
      setClosedNow(refusal.words);
      setEditing(false);
      announce(refusal.words);
      focusNext.current = 'closed';
      return;
    }
    setAlert(refusal.words);
    announce(refusal.words, { assertive: true });
  }

  async function skip() {
    if (!rating || sending.current) return;
    if (state === 'skipped') {
      // Already skipped on the server: closing the card again needs no request.
      setEditing(false);
      announce(RATING_COPY.skipped);
      focusNext.current = 'rateButton';
      return;
    }
    if (!online) {
      announce(RATING_COPY.offline);
      return;
    }
    sending.current = true;
    setPending('skip');
    const outcome = await client.skip(orderId);
    sending.current = false;
    setPending(null);
    if (outcome.ok) {
      onChange(outcome.data);
      setEditing(false);
      announce(RATING_COPY.skipped);
      focusNext.current = 'rateButton';
      return;
    }
    const refusal = sendRefusal(outcome.error, rating.closedOnWords);
    if (refusal.kind === 'closed') {
      setClosedNow(refusal.words);
      announce(refusal.words);
      focusNext.current = 'closed';
      return;
    }
    setAlert(refusal.words);
    announce(refusal.words, { assertive: true });
  }

  let body: ReactNode;
  if (mode === 'closedLine') {
    body = (
      <div id="rate" className="mt-6 scroll-mt-6">
        <p
          data-focus="closed"
          tabIndex={-1}
          className="flex justify-center gap-2 text-body-5 text-neutral-3 focus:outline-none"
        >
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          {closedNow}
        </p>
      </div>
    );
  } else if (mode === 'skipped') {
    body = (
      <div id="rate" className="mt-6 flex scroll-mt-6 justify-center">
        <Button
          type="button"
          variant="outline"
          size="touch"
          data-focus="rateButton"
          className="bg-white"
          onClick={openForm}
        >
          <Star className="size-4" aria-hidden />
          {RATING_COPY.rateThisOrder}
        </Button>
      </div>
    );
  } else if (mode === 'summary') {
    const closed = !editable;
    body = (
      <section id="rate" aria-labelledby={headingId} className={CARD}>
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft"
          >
            <Check className="size-5 text-brand-strong" />
          </span>
          <div className="min-w-0">
            <h2
              id={headingId}
              data-focus="summary"
              tabIndex={-1}
              className="font-heading text-title-2 leading-tight text-neutral-1 focus:outline-none"
            >
              {RATING_COPY.yourRatings}
            </h2>
            {thanked ? (
              <p className="mt-1 text-body-4 text-neutral-2">
                {thanksLine(customerFirst, courierFirst)}
              </p>
            ) : null}
          </div>
        </div>
        <ul aria-label={summaryListName(orderNumber)} className="mt-4 space-y-2">
          {rating.dishes.map((dish) => (
            <SummaryItem key={dish.menuItemId} name={dish.title} stars={dish.stars} />
          ))}
          {rating.courier ? (
            <SummaryItem name={rating.courier.firstName} stars={rating.courier.stars} />
          ) : null}
        </ul>
        {closedNow ? (
          <FormAlert
            variant="info"
            icon={Lock}
            data-focus="closed"
            tabIndex={-1}
            className="mt-4 focus:outline-none"
          >
            {closedNow}
          </FormAlert>
        ) : null}
        {closed ? (
          closedNow ? null : (
            <p className="mt-4 flex gap-2 text-body-5 text-neutral-3">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              {closedLine(rating.closedOnWords)}
            </p>
          )
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              type="button"
              variant="outline"
              size="touch"
              data-focus="editButton"
              className="bg-white"
              onClick={openForm}
            >
              <SquarePen className="size-4" aria-hidden />
              {RATING_COPY.editRatings}
            </Button>
            {rating.closesOnWords ? (
              <p className="text-body-5 text-neutral-3">{editUntilLine(rating.closesOnWords)}</p>
            ) : null}
          </div>
        )}
      </section>
    );
  } else {
    const busy = pending !== null;
    body = (
      <section id="rate" aria-labelledby={headingId} className={CARD}>
        <h2
          id={headingId}
          data-focus="heading"
          tabIndex={-1}
          className="font-heading text-title-1 leading-tight text-neutral-1 focus:outline-none"
        >
          {cardHeading(orderNumber)}
        </h2>
        {empty ? (
          <p id={errorId} className="mt-2 flex gap-2 text-body-5 text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {RATING_COPY.nothingPicked}
          </p>
        ) : null}
        <div inert={busy || undefined}>
          <ul aria-label="Dishes" className="mt-4 divide-y divide-neutral-6">
            {rating.dishes.map((dish) => (
              <DishRow
                key={dish.menuItemId}
                idBase={idBase}
                dish={dish}
                row={rowOf(dish.menuItemId)}
                demo={rating.demo}
                showError={empty ? errorId : null}
                onChange={(next) => setRow(dish.menuItemId, next)}
              />
            ))}
          </ul>
          <p className="mt-4 flex gap-2 text-body-5 text-neutral-3">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {RATING_COPY.whoReads}
          </p>
          {rating.courier ? (
            <section
              aria-labelledby={courierHeadingId}
              className="mt-6 border-t border-neutral-6 pt-6"
            >
              <h3 id={courierHeadingId} className="text-body-3 font-semibold text-neutral-1">
                {courierHeading(rating.courier.firstName)}
              </h3>
              <CourierRow
                idBase={idBase}
                courier={rating.courier}
                photoUrl={courierPhotoUrl}
                row={draft.courier ?? EMPTY_ROW}
                demo={rating.demo}
                showError={empty ? errorId : null}
                onChange={setCourier}
              />
              <p className="flex gap-2 text-body-5 text-neutral-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                {courierPrivacy(rating.courier.firstName)}
              </p>
            </section>
          ) : null}
          {rating.demo ? (
            <p className="mt-6 flex gap-2 text-body-5 text-neutral-3">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              {RATING_COPY.demoComments}
            </p>
          ) : null}
        </div>
        {alert ? (
          <FormAlert variant="error" className="mt-6">
            {alert}
          </FormAlert>
        ) : null}
        <div className="mt-6 flex flex-col gap-3 md:flex-row-reverse md:justify-start">
          <SubmitButton
            type="button"
            pending={pending === 'send'}
            pendingLabel={isEdit ? RATING_COPY.saving : RATING_COPY.sending}
            blocked={!online}
            onBlockedPress={() => announce(RATING_COPY.offline)}
            aria-describedby={online ? undefined : offlineId}
            className="w-full uppercase md:w-auto"
            onClick={() => void send()}
          >
            {isEdit ? RATING_COPY.saveChanges : RATING_COPY.send}
          </SubmitButton>
          {isEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="touch"
              aria-disabled={busy || undefined}
              className="w-full md:w-auto"
              onClick={() => {
                if (busy) return;
                setEditing(false);
                focusNext.current = 'editButton';
              }}
            >
              {RATING_COPY.cancel}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="touch"
              aria-disabled={busy || undefined}
              className="w-full underline underline-offset-4 md:w-auto"
              onClick={() => void skip()}
            >
              {RATING_COPY.skip}
            </Button>
          )}
        </div>
        {online ? null : (
          <p id={offlineId} className="mt-2 text-body-5 text-neutral-3 md:text-right">
            {RATING_COPY.offline}
          </p>
        )}
      </section>
    );
  }

  return <div ref={rootRef}>{body}</div>;
}

function SummaryItem({ name, stars }: { name: string; stars: Stars | null }) {
  return (
    <li className="flex min-h-8 items-center justify-between gap-3">
      <span className="min-w-0 text-body-4 text-neutral-1 [overflow-wrap:anywhere]">{name}</span>
      {stars ? (
        <StarsDisplay stars={stars} withWord className="shrink-0" />
      ) : (
        <span className="shrink-0 text-body-5 text-neutral-3">{RATING_COPY.notRated}</span>
      )}
    </li>
  );
}
