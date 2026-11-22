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
  compareText,
  isMinimumReason,
  noLongerAppliedText,
  promoAppliedText,
  tooManyCodesText,
} from '@/lib/cart-text';
import { useCartActions } from '@/lib/data/cart';
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
  type PromoMessage,
  PromoMessageLine,
} from './promo-parts';
import { fetchQuote, type QuoteRequest, quoteQueryKey, requestKey } from './use-quote';

/*
 * Promo codes in the cart (F3 S4, design 2.10 to 2.14). The first check is on Apply, Enter or
 * leaving the field; after the first answer it checks again 400 ms after typing stops. Only the
 * newest answer shows. A refused code is never sent again (each unknown code spends a guessing
 * point); the cart's own code is sent in every quote only while it is applied or not applied yet.
 */

const PROMO_OFFLINE = "You're offline. We'll check the code when you're back online.";

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
  /** Running offers under the field (the cart); checkout leaves them out (F4 design 2.6.5). */
  showOffers?: boolean;
  className?: string;
}

export function PromoSection({
  request,
  quote,
  storedCode,
  signedIn,
  onCodeEnded,
  onAction,
  onNavigate,
  showOffers = true,
  className = 'mt-8',
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
  const [message, setMessage] = useState<PromoMessage | null>(null);
  const [checking, setChecking] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const [compare, setCompare] = useState<CompareState | null>(null);
  const slowChecking = useSlowPending(checking);

  const requestId = useRef(0);
  const inFlight = useRef<string | null>(null);
  const lastChecked = useRef<string | null>(null);
  const waitingOnline = useRef<string | null>(null);
  const previous = useRef<{ code: string; status: QuotePromo['status'] } | null>(null);

  const blocked = blockedUntil !== null;
  const storedPromo = quote?.promo && quote.promo.code === storedCode ? quote.promo : null;

  const say = (next: PromoMessage) => {
    setMessage(next);
    announce(next.text);
  };

  const failed = (failure: ActionFailure, code: string) => {
    if (failure.code === 'OFFLINE') {
      waitingOnline.current = code;
      say({ tone: 'offline', text: PROMO_OFFLINE });
    } else {
      say({ tone: 'error', text: PROMO_UNAVAILABLE, invalid: false });
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
  const answer = (promo: QuotePromo | null, quoted: Quote, canAttach: boolean) => {
    if (!promo) return;
    switch (promo.status) {
      case 'applied':
      case 'notApplied':
        if (canAttach) attach(promo, quoted);
        say(
          promo.status === 'applied'
            ? { tone: 'success', text: promoAppliedText(promo) }
            : { tone: 'neutral', text: promo.message ?? '' },
        );
        return;
      case 'refused':
        say({
          tone: 'error',
          text: promo.message ?? PROMO_UNAVAILABLE,
          invalid: true,
          signInCode: promo.reason?.code === 'signInRequired' ? promo.code : undefined,
        });
        return;
      default:
        if (promo.reason?.code === 'rateLimited') {
          const wait = promo.retryAfterSeconds ?? 600;
          setBlockedUntil(Date.now() + wait * 1000);
          say({ tone: 'limited', text: promo.message ?? tooManyCodesText(wait) });
        } else {
          say({ tone: 'error', text: PROMO_UNAVAILABLE, invalid: false });
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
      say({
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
      say({ tone: 'offline', text: PROMO_OFFLINE });
      return;
    }
    if (code === storedCode && storedPromo?.status === 'applied') {
      setTyped('');
      say({ tone: 'success', text: promoAppliedText(storedPromo) });
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
          const card = {
            current: { code: storedCode, totalCents: current.data.totalCents },
            next: { code: nextPromo.code, totalCents: next.data.totalCents },
          };
          setMessage(null);
          setCompare({ status: 'ready', ...card, nextQuote: next.data });
          announce(compareText(card.current, card.next));
          return;
        }
        if (nextPromo?.status === 'notApplied') {
          say({ tone: 'neutral', text: `${nextPromo.message ?? ''} ${storedCode} stays applied.` });
          return;
        }
        answer(nextPromo, next.data, false);
        return;
      }
      const outcome = await fetchQuote({ ...request, code });
      if (ticket !== requestId.current) return;
      if (!outcome.ok) {
        failed(outcome.error, code);
        return;
      }
      answer(outcome.data.promo, outcome.data, true);
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
        say({
          tone: 'error',
          text: promo.message ?? PROMO_UNAVAILABLE,
          invalid: false,
          signInCode: promo.reason?.code === 'signInRequired' ? promo.code : undefined,
        });
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
        setMessage(null);
        announce('You can try codes again.');
      },
      Math.max(0, blockedUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [blockedUntil]);

  useEffect(() => {
    if (!arrivedWith) return;
    clearPendingPromo();
    void latest.current.check(arrivedWith);
  }, [arrivedWith]);

  useEffect(() => {
    latest.current.followQuote(quote, storedCode);
  }, [quote, storedCode]);

  const focusField = () => {
    setExpanded(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const removeCode = () => {
    if (!storedCode) return;
    onAction();
    cart.setCode(null);
    previous.current = null;
    setMessage(null);
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
    setMessage(null);
    announce(`${next.code} applied. ${current.code} removed.`);
    focusField();
  };

  const invalid = message?.tone === 'error' && message.invalid;
  const signInHref = signInFor('/sign-in', returnPathFor(pathname, search), 'promo');
  const showChip = storedCode !== null;

  return (
    <div className={className}>
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
      {showOffers ? (
        <CartOffers
          offers={quote?.offers ?? []}
          appliedCode={storedPromo?.status === 'applied' ? storedCode : null}
          onApply={(code) => {
            void check(code, { fromField: false });
          }}
        />
      ) : null}
    </div>
  );
}
