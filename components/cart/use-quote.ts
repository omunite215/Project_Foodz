'use client';

import { useDebouncedValue } from '@tanstack/react-pacer';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { quoteCartAction } from '@/server/modules/cart/actions';
import {
  type DeliveryTargetInput,
  type PaymentMethodChoice,
  type Quote,
  quoteInput,
  type QuoteLineInput,
  type TipChoice,
} from '@/server/modules/cart/schema';
import { useSlowPending } from '@/components/forms/submit-button';
import { type ActionFailure, type ActionOutcome, callAction } from '@/lib/action-result';
import { useOnline } from '@/lib/use-online';
import type { QuoteStatus } from './price-breakdown';

/*
 * The cart's price breakdown from the server (F3 B2, design 2.18). It asks when the cart opens,
 * 300 ms after the last change (Pacer), when the tab is shown again, once a minute while open and
 * when the browser comes back online. Only the newest answer is shown; a late older one is
 * dropped. An answer that takes 10 s is given up on.
 */

export interface QuoteRequest {
  lines: QuoteLineInput[];
  code?: string;
  delivery: DeliveryTargetInput;
  /** Checkout only (F4 B14): the tip choice and the payment method. The cart sends neither. */
  tip?: TipChoice;
  method?: PaymentMethodChoice;
}

export const QUOTE_TIMEOUT_MS = 10_000;
const DEBOUNCE_MS = 300;
const REFRESH_MS = 60_000;

export class QuoteFailure extends Error {
  constructor(readonly failure: ActionFailure) {
    super(failure.message);
  }
}

/** One stable string per request, the cache key of its answer. */
export const requestKey = (request: QuoteRequest) =>
  JSON.stringify({
    lines: request.lines,
    delivery: request.delivery,
    ...(request.code ? { code: request.code } : {}),
    ...(request.tip ? { tip: request.tip } : {}),
    ...(request.method ? { method: request.method } : {}),
  });

export const quoteQueryKey = (key: string) => ['cart-quote', key] as const;

export function fetchQuote(request: QuoteRequest): Promise<ActionOutcome<Quote>> {
  return callAction(
    () =>
      quoteCartAction({
        lines: request.lines,
        delivery: request.delivery,
        ...(request.code ? { code: request.code } : {}),
        ...(request.tip ? { tip: request.tip } : {}),
        ...(request.method ? { method: request.method } : {}),
      }),
    { timeoutMs: QUOTE_TIMEOUT_MS },
  );
}

export interface QuoteView {
  /** The answer to show (the previous one while a new one is on its way). */
  quote: Quote | null;
  /** The newest answer that came back, also while failing (for the cart-full notice). */
  lastQuote: Quote | null;
  status: QuoteStatus;
  failure: ActionFailure | null;
  /** On its way for 150 ms: dim the figures. */
  dim: boolean;
  /** On its way for 300 ms: say "Updating your total…". */
  slow: boolean;
  /** The request the shown answer is for (to tell a settled change from an old answer). */
  answeredKey: string | null;
  currentKey: string;
  retry: () => void;
}

export function useQuote(
  request: QuoteRequest,
  enabled: boolean,
  /** Each answer as it arrives (dishes gone from the menu, extras dropped). */
  onAnswer?: (quote: Quote) => void,
): QuoteView {
  const currentKey = requestKey(request);
  const [debouncedKey] = useDebouncedValue(currentKey, { wait: DEBOUNCE_MS });
  const online = useOnline();
  const queryClient = useQueryClient();
  const hasLines = request.lines.length > 0;
  const answered = useRef(onAnswer);
  useEffect(() => {
    answered.current = onAnswer;
  });

  const query = useQuery({
    queryKey: quoteQueryKey(debouncedKey),
    queryFn: async () => {
      const outcome = await fetchQuote(quoteInput.parse(JSON.parse(debouncedKey)));
      if (!outcome.ok) throw new QuoteFailure(outcome.error);
      answered.current?.(outcome.data);
      return outcome.data;
    },
    enabled: enabled && hasLines,
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  const failure = query.error instanceof QuoteFailure ? query.error.failure : null;
  // The newest answer that came back, kept while a later request fails or is held back.
  const [last, setLast] = useState<{ key: string; quote: Quote } | null>(null);
  if (query.data && !query.isPlaceholderData && last?.quote !== query.data) {
    setLast({ key: debouncedKey, quote: query.data });
  }

  // Too many quotes: try again by itself once the wait is over (B5).
  const retryAfter = failure?.code === 'RATE_LIMITED' ? (failure.retryAfterSeconds ?? 5) : null;
  const { refetch } = query;
  useEffect(() => {
    if (retryAfter === null) return undefined;
    const timer = setTimeout(() => void refetch(), retryAfter * 1000);
    return () => clearTimeout(timer);
  }, [retryAfter, refetch]);

  const waiting =
    currentKey !== debouncedKey || query.isPlaceholderData || (query.isFetching && !query.data);
  let status: QuoteStatus;
  if (!online) status = 'offline';
  else if (failure?.code === 'RATE_LIMITED') status = 'rateLimited';
  else if (failure?.code === 'CART_TOO_BIG') status = 'tooBig';
  else if (query.isError) status = 'failed';
  else if (!query.data) status = 'loading';
  else if (waiting) status = 'updating';
  else status = 'ready';

  const pending = status === 'updating' || status === 'loading';
  const dim = useSlowPending(pending, 150);
  const slow = useSlowPending(pending, 300);

  const shown =
    status === 'rateLimited'
      ? (last?.quote ?? null)
      : status === 'failed' || status === 'offline' || status === 'tooBig'
        ? null
        : (query.data ?? null);

  return {
    quote: shown,
    lastQuote: last?.quote ?? null,
    status,
    failure,
    dim: dim || status === 'rateLimited',
    slow,
    answeredKey: status === 'ready' ? debouncedKey : null,
    currentKey,
    retry: () => {
      void queryClient.refetchQueries({ queryKey: quoteQueryKey(debouncedKey) });
    },
  };
}
