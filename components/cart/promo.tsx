'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, TicketPercent } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import {
  isPossibleCode,
  normalizeCode,
  type Quote,
  type QuotePromo,
} from '@/server/modules/cart/schema';
import { PROMO_UNAVAILABLE, promoMessage } from '@/server/modules/cart/promo-text';
import { useSlowPending } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import type { ActionFailure } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { returnPathFor } from '@/lib/auth-links';
import {
  codeEndedText,
  compareSide,
  compareText,
  isMinimumReason,
  noLongerAppliedText,
  promoAppliedText,
  tooManyCodesText,
} from '@/lib/cart-text';
import { useCartActions } from '@/lib/data/cart';
import { prefersReducedMotion } from '@/lib/motion';
import {
  linesKey,
  noteFor,
  type PromoMessage,
  type PromoNote,
  promoFieldMessage,
} from '@/lib/promo-field';
import {
  clearPendingPromo,
  readPendingPromo,
  requestCartReopen,
  signInFor,
  writePendingPromo,
} from '@/lib/sign-in-reason';
import { useOnline } from '@/lib/use-online';
import { cn } from '@/lib/utils';
import {
  CartOffers,
  type CompareState,
  PromoChip,
  PromoCompare,
  PromoMessageLine,
} from './promo-parts';
import { fetchQuote, type QuoteRequest, quoteQueryKey, requestKey } from './use-quote';

/*
 * Promo codes in the cart (F3 S4, design 2.10 to 2.14). A code is checked on Apply, Enter or
 * leaving the field, never while typing. Only the newest answer shows. A refused code is never
 * sent again (each unknown code spends a guessing point); the cart's own code is sent in every
 * quote only while it is applied or not applied yet.
 */

const PROMO_OFFLINE = "You're offline. We'll check the code when you're back online.";

/**
 * Scrolls the cart (its body, or the whole panel on short screens) the least needed to show
 * `element`. Not `scrollIntoView`, which may also scroll the page behind the dialog.
 */
function scrollIntoCart(element: HTMLElement) {
  let scroller = element.parentElement;
  while (scroller) {
    const { overflowY } = getComputedStyle(scroller);
    if (/auto|scroll/.test(overflowY) && scroller.scrollHeight > scroller.clientHeight) break;
    scroller = scroller.parentElement;
  }
  if (!scroller || scroller === document.documentElement || scroller === document.body) return;
  const box = element.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const margin = 12;
  let by = 0;
  if (box.top < view.top + margin) by = box.top - view.top - margin;
  else if (box.bottom > view.bottom - margin) {
    by = Math.min(box.bottom - view.bottom + margin, box.top - view.top - margin);
  }
  if (by !== 0) {
    scroller.scrollBy({ top: by, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
  }
}

// ------------------------------------------------------------------ the section and its logic

export interface PromoSectionProps {
  /** The cart as it would be quoted, without a code. */
  request: Omit<QuoteRequest, 'code'>;
  /** The cart's own quote (with its code, when it has one). */
  quote: Quote | null;
  storedCode: string | null;
  signedIn: boolean;
  /** "KBBQ5 ended at 9:00 pm, …" for the notices (S3.6). */
  onCodeEnded: (text: string) => void;
  /** Her next action in the cart (clears the undo row). */
  onAction: () => void;
  /** A link out of the cart is about to replace its history entry. */
  onNavigate: () => void;
}

export function PromoSection({
  request,
  quote,
  storedCode,
  signedIn,
  onCodeEnded,
  onAction,
  onNavigate,
}: PromoSectionProps) {
  const cart = useCartActions();
  const queryClient = useQueryClient();
  const online = useOnline();
  const pathname = usePathname();
  const search = useSearchParams();
  const id = useId();
  const inputId = `${id}-input`;
  const messageId = `${id}-message`;
  const fieldId = `${id}-field`;
  const inputRef = useRef<HTMLInputElement>(null);

  // Back from signing in for a code (S4.8): the code waits in this tab, to be checked as her.
  const [arrivedWith] = useState(() => (signedIn ? readPendingPromo() : null));
  const [typed, setTyped] = useState(arrivedWith ?? '');
  const [expanded, setExpanded] = useState(arrivedWith !== null);
  const [note, setNote] = useState<PromoNote | null>(null);
  const [checking, setChecking] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const [compare, setCompare] = useState<CompareState | null>(null);
  const slowChecking = useSlowPending(checking);

  const requestId = useRef(0);
  /** An offer's Apply was pressed: its answer is brought into view once it is drawn. */
  const revealAnswer = useRef(false);
  const inFlight = useRef<string | null>(null);
  const lastChecked = useRef<string | null>(null);
  const waitingOnline = useRef<string | null>(null);
  const previous = useRef<{ code: string; status: QuotePromo['status'] } | null>(null);

  const blocked = blockedUntil !== null;
  const storedPromo = quote?.promo && quote.promo.code === storedCode ? quote.promo : null;
  // The message under the field follows the code's chip through every quote, and one about
  // these dishes goes once they change (D2): it is the field's description too.
  const message = promoFieldMessage(note, {
    storedCode,
    promo: quote?.promo ?? null,
    linesKey: linesKey(request.lines),
  });

  // Once the cart holds the attached code, its message goes if the code later comes off.
  if (note?.kind === 'code' && !note.seen && storedCode === note.code) {
    setNote({ ...note, seen: true });
  }

  const say = (next: PromoNote) => {
    setNote(next);
    announce(next.message.text);
  };
  const sayFixed = (next: PromoMessage) => say({ kind: 'fixed', message: next });

  const failed = (failure: ActionFailure, code: string) => {
    if (failure.code === 'OFFLINE') {
      waitingOnline.current = code;
      sayFixed({ tone: 'offline', text: PROMO_OFFLINE });
    } else {
      sayFixed({ tone: 'error', text: PROMO_UNAVAILABLE, invalid: false });
    }
  };

  const attach = (promo: QuotePromo, answer: Quote) => {
    cart.setCode(promo.code);
    queryClient.setQueryData(quoteQueryKey(requestKey({ ...request, code: promo.code })), answer);
    previous.current = { code: promo.code, status: promo.status };
    setTyped('');
    lastChecked.current = null;
  };

  /** What a code's answer means for the field, the message and the cart's code. */
  const answer = (
    promo: QuotePromo | null,
    quoted: Quote,
    canAttach: boolean,
    fromField: boolean,
  ) => {
    if (!promo) return;
    switch (promo.status) {
      case 'applied':
      case 'notApplied': {
        const said: PromoMessage =
          promo.status === 'applied'
            ? { tone: 'success', text: promoAppliedText(promo) }
            : { tone: 'neutral', text: promo.message ?? '' };
        if (canAttach) {
          attach(promo, quoted);
          say({ kind: 'code', code: promo.code, message: said });
        } else {
          say(noteFor(said, promo.reason, quoted.lines));
        }
        return;
      }
      case 'refused':
        say(
          noteFor(
            {
              tone: 'error',
              text: promo.message ?? PROMO_UNAVAILABLE,
              // An offer's Apply leaves the field empty; only a typed code marks it invalid (2.14).
              invalid: fromField,
              signInCode: promo.reason?.code === 'signInRequired' ? promo.code : undefined,
            },
            promo.reason,
            quoted.lines,
          ),
        );
        return;
      default:
        if (promo.reason?.code === 'rateLimited') {
          const wait = promo.retryAfterSeconds ?? 600;
          setBlockedUntil(Date.now() + wait * 1000);
          sayFixed({ tone: 'limited', text: promo.message ?? tooManyCodesText(wait) });
        } else {
          sayFixed({ tone: 'error', text: PROMO_UNAVAILABLE, invalid: false });
        }
    }
  };

  async function check(raw: string, { fromField = true }: { fromField?: boolean } = {}) {
    const code = normalizeCode(raw);
    if (!code || code.length > 32 || blocked || inFlight.current === code) return;
    // A code that can't exist is answered here: sending it would only spend a guessing point.
    if (!isPossibleCode(code)) {
      if (fromField) inputRef.current?.focus();
      lastChecked.current = code;
      sayFixed({
        tone: 'error',
        // The "not found" sentence has no date in it, so the time zone doesn't matter.
        text: promoMessage(code, { code: 'notFound', rule: 'R1' }, { timeZone: 'UTC' }),
        invalid: true,
      });
      return;
    }
    // Focus stays in the field after Apply (S7.5).
    if (fromField) inputRef.current?.focus();
    onAction();
    setCompare(null);
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      waitingOnline.current = code;
      sayFixed({ tone: 'offline', text: PROMO_OFFLINE });
      return;
    }
    if (code === storedCode && storedPromo?.status === 'applied') {
      setTyped('');
      say({
        kind: 'code',
        code,
        message: { tone: 'success', text: promoAppliedText(storedPromo) },
      });
      return;
    }

    const ticket = ++requestId.current;
    inFlight.current = code;
    setChecking(true);
    try {
      if (storedCode && storedCode !== code) {
        const [current, next] = await Promise.all([
          fetchQuote({ ...request, code: storedCode }),
          fetchQuote({ ...request, code }),
        ]);
        if (ticket !== requestId.current) return;
        if (!next.ok) {
          failed(next.error, code);
          return;
        }
        const nextPromo = next.data.promo;
        if (nextPromo?.status === 'applied') {
          if (!current.ok) {
            setCompare({ status: 'failed', code });
            announce("We couldn't compare the totals.");
            return;
          }
          // Each total says whether delivery is in it yet (D5).
          const card = {
            current: compareSide(storedCode, current.data),
            next: compareSide(nextPromo.code, next.data),
          };
          setNote(null);
          setCompare({ status: 'ready', ...card, nextQuote: next.data });
          announce(compareText(card.current, card.next));
          return;
        }
        if (nextPromo?.status === 'notApplied') {
          say({
            kind: 'lines',
            linesKey: linesKey(next.data.lines),
            message: {
              tone: 'neutral',
              text: `${nextPromo.message ?? ''} ${storedCode} stays applied.`,
            },
          });
          return;
        }
        answer(nextPromo, next.data, false, fromField);
        return;
      }
      const outcome = await fetchQuote({ ...request, code });
      if (ticket !== requestId.current) return;
      if (!outcome.ok) {
        failed(outcome.error, code);
        return;
      }
      answer(outcome.data.promo, outcome.data, true, fromField);
    } finally {
      if (ticket === requestId.current) {
        setChecking(false);
        inFlight.current = null;
        lastChecked.current = code;
      }
    }
  }

  /** What each new quote means for the cart's own code (S4.6, S4.9, S4.15, S3.6). */
  const followQuote = (newest: Quote | null, code: string | null) => {
    if (!code || !newest?.promo || newest.promo.code !== code) return;
    const promo = newest.promo;
    const before = previous.current?.code === code ? previous.current.status : null;
    previous.current = { code, status: promo.status };
    if (before === promo.status) return;
    if (before === 'notApplied' && promo.status === 'applied') {
      announce(promoAppliedText(promo));
    } else if (
      before === 'applied' &&
      promo.status === 'notApplied' &&
      isMinimumReason(promo.reason)
    ) {
      announce(noLongerAppliedText(promo.code, promo.reason));
    } else if (promo.status === 'refused') {
      // Never sent again: a refused code would spend a guessing point on every quote.
      cart.setCode(null);
      const ended = promo.reason?.code === 'ended' || promo.reason?.code === 'notFound';
      if (before === 'applied' && ended) {
        onCodeEnded(
          codeEndedText(
            promo.code,
            promo.reason?.code === 'ended' ? promo.reason.endedAt : null,
            newest.store.timeZone,
            newest.totalCents,
          ),
        );
      } else {
        // R8 after a dish came out holds only for these dishes: an Undo clears it (D2).
        say(
          noteFor(
            {
              tone: 'error',
              text: promo.message ?? PROMO_UNAVAILABLE,
              invalid: false,
              signInCode: promo.reason?.code === 'signInRequired' ? promo.code : undefined,
            },
            promo.reason,
            newest.lines,
          ),
        );
      }
    }
  };

  // Effects call the newest versions, which read the newest cart.
  const latest = useRef({ check, followQuote });
  useEffect(() => {
    latest.current = { check, followQuote };
  });

  // Back online: the code that was waiting is checked without her doing anything (S7.14).
  useEffect(() => {
    if (!online || !waitingOnline.current) return;
    const code = waitingOnline.current;
    waitingOnline.current = null;
    void latest.current.check(code);
  }, [online]);

  // Too many codes: the field comes back by itself once the wait is over (S4.13).
  useEffect(() => {
    if (blockedUntil === null) return undefined;
    const timer = setTimeout(
      () => {
        setBlockedUntil(null);
        setNote(null);
        announce('You can try codes again.');
      },
      Math.max(0, blockedUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [blockedUntil]);

  useEffect(() => {
    if (!arrivedWith) return;
    clearPendingPromo();
    // Back from sign-in, focus stays on the cart's heading rather than the emptied field.
    void latest.current.check(arrivedWith, { fromField: false });
  }, [arrivedWith]);

  useEffect(() => {
    latest.current.followQuote(quote, storedCode);
  }, [quote, storedCode]);

  /** Scrolls the field, its message and the compare card into view in the cart. */
  const showField = () => {
    const field = document.getElementById(fieldId);
    if (field) scrollIntoCart(field);
  };

  // An offer's answer shows under the field, which can be above the offers on screen.
  useEffect(() => {
    if (!revealAnswer.current || checking || (!message && !compare)) return;
    revealAnswer.current = false;
    showField();
  });

  const focusField = () => {
    setExpanded(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const removeCode = () => {
    if (!storedCode) return;
    onAction();
    cart.setCode(null);
    previous.current = null;
    setNote(null);
    announce(`${storedCode} removed.`);
    focusField();
  };

  const keep = () => {
    if (compare?.status !== 'ready') return;
    setCompare(null);
    setTyped('');
    announce(`Kept ${compare.current.code}.`);
    focusField();
  };

  const use = () => {
    if (compare?.status !== 'ready') return;
    const { current, next, nextQuote } = compare;
    if (nextQuote.promo) attach(nextQuote.promo, nextQuote);
    setCompare(null);
    setNote(null);
    announce(`${next.code} applied. ${current.code} removed.`);
    focusField();
  };

  const invalid = message?.tone === 'error' && message.invalid;
  const signInHref = signInFor('/sign-in', returnPathFor(pathname, search), 'promo');
  const showChip = storedCode !== null;

  return (
    <div className="mt-8">
      {showChip ? (
        <div className="mb-3">
          <PromoChip
            code={storedCode}
            promo={
              storedPromo &&
              (storedPromo.status === 'applied' || storedPromo.status === 'notApplied')
                ? storedPromo
                : null
            }
            onRemove={removeCode}
          />
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={fieldId}
        onClick={() => {
          if (expanded) setExpanded(false);
          else focusField();
        }}
        className="flex h-11 w-full items-center gap-3 rounded-lg px-1 text-body-4 font-medium text-neutral-2 outline-none hover:bg-neutral-7 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid md:hidden"
      >
        <TicketPercent className="size-5 text-brand-strong" aria-hidden />
        {showChip ? 'Use a different code' : 'Add a promo code'}
        <ChevronDown
          className={cn(
            'ml-auto size-5 text-neutral-3 transition-transform duration-150',
            expanded && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      <div id={fieldId} className={cn(expanded ? 'block' : 'hidden md:block', 'max-md:mt-2')}>
        <label htmlFor={inputId} className="text-body-4 text-neutral-3">
          Promo code
        </label>
        <div className="mt-2 flex gap-2">
          <Input
            ref={inputRef}
            id={inputId}
            value={typed}
            disabled={blocked}
            maxLength={32}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-invalid={invalid || undefined}
            aria-describedby={messageId}
            onChange={(event) => {
              const value = event.target.value;
              setTyped(value);
              if (compare) setCompare(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void check(typed);
              } else if (event.key === 'Escape' && compare) {
                event.preventDefault();
                event.stopPropagation();
                setCompare(null);
              }
            }}
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (next instanceof HTMLElement && next.dataset.promoApply !== undefined) return;
              const code = normalizeCode(typed);
              if (code && code !== lastChecked.current && code !== storedCode) {
                void check(typed);
              }
            }}
            className="h-11 min-w-0 flex-1 uppercase tracking-wider"
          />
          <Button
            type="button"
            variant="outline"
            size="touch"
            data-promo-apply=""
            aria-disabled={checking || blocked || undefined}
            onClick={() => {
              void check(typed);
            }}
            className="min-w-24 border-brand-strong bg-white text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
          >
            {slowChecking ? (
              <>
                <Spinner className="size-4 motion-reduce:animate-none" />
                Checking…
              </>
            ) : (
              'Apply'
            )}
          </Button>
        </div>
        <PromoMessageLine
          id={messageId}
          message={message}
          signInHref={signInHref}
          onSignIn={() => {
            if (message?.tone === 'error' && message.signInCode) {
              writePendingPromo(message.signInCode);
            }
            requestCartReopen();
            onNavigate();
          }}
        />
        {compare ? (
          <PromoCompare
            state={compare}
            onKeep={keep}
            onUse={use}
            onRetry={() => {
              if (compare.status === 'ready') return;
              const code = compare.code;
              setCompare({ status: 'loading', code });
              void check(code);
            }}
          />
        ) : null}
      </div>
      <CartOffers
        offers={quote?.offers ?? []}
        appliedCode={storedPromo?.status === 'applied' ? storedCode : null}
        onApply={(code) => {
          // Below md the field, its answer, "Checking…" and the compare card are folded away
          // until opened: an offer's Apply opens them (2.14).
          setExpanded(true);
          revealAnswer.current = true;
          requestAnimationFrame(showField);
          void check(code, { fromField: false });
        }}
      />
    </div>
  );
}
