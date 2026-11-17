'use client';

import { useDebouncer } from '@tanstack/react-pacer';
import { CircleExclamationPoint, MapPin, SearchX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { searchAddressesAction } from '@/server/modules/addresses/actions';
import type { AddressSuggestion } from '@/server/modules/addresses/schema';
import type { FieldControlProps } from '@/components/forms/field-shell';
import { useSlowPending } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { callAction, isOffline } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

export const NOT_FOUND_TEXT =
  "We couldn't find that address. Check the spelling or try a nearby street.";
export const SEARCH_DOWN_TEXT =
  "We can't look up addresses right now. Please try again in a minute.";
const OFFLINE_TEXT = "You're offline. We'll look up addresses when you're back online.";

const MIN_QUERY = 3;
const SEARCH_TIMEOUT_MS = 5_000;
const SEARCHING_DELAY_MS = 300;
const ANNOUNCE_DELAY_MS = 500;
const LISTBOX_ID = 'address-options';

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'results'; items: AddressSuggestion[] }
  | { kind: 'none' }
  | { kind: 'down' }
  | { kind: 'offline' };

const countText = (count: number) =>
  count === 1
    ? '1 address found.'
    : `${count} addresses found. Use the up and down arrows to choose.`;

/** A message in the popup that is not an option (nothing found, search down, offline). */
function Panel({
  icon,
  text,
  action,
}: {
  icon: React.ReactNode;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 p-4 text-body-5 text-neutral-3">
      {icon}
      <div>
        <p>{text}</p>
        {action}
      </div>
    </div>
  );
}

function Popup({
  state,
  active,
  slow,
  onPick,
  onHover,
  onRetry,
}: {
  state: SearchState;
  active: number;
  slow: boolean;
  onPick: (item: AddressSuggestion) => void;
  onHover: (index: number) => void;
  onRetry: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(
    (motion) => {
      if (!ref.current || motion.reduced) return;
      motion.from(ref.current, { y: -4, opacity: 0, duration: 0.15, ease: 'power2.out' });
    },
    { scope: ref },
  );

  return (
    <div
      ref={ref}
      className="absolute inset-x-0 top-full z-20 mt-2 max-h-[320px] overflow-auto rounded-xl border border-neutral-6 bg-white py-1 shadow-raised"
    >
      {state.kind === 'results' ? (
        <>
          {/* The ARIA combobox pattern: a styled two-line list a native <select> can't draw. */}
          {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
          <div id={LISTBOX_ID} role="listbox" aria-label="Address suggestions">
            {state.items.map((item, index) => (
              <div
                key={item.id}
                id={`${LISTBOX_ID}-${index}`}
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                role="option"
                aria-selected={index === active}
                // Picking happens on pointer down, before the field loses focus.
                onPointerDown={(event) => {
                  event.preventDefault();
                  onPick(item);
                }}
                onPointerMove={() => onHover(index)}
                className={cn(
                  'flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2',
                  index === active && 'bg-neutral-7',
                )}
              >
                <MapPin className="size-5 shrink-0 text-neutral-3" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-body-4 font-medium text-neutral-1 [overflow-wrap:anywhere]">
                    {item.line1}
                  </span>
                  <span className="block text-body-5 text-neutral-3 [overflow-wrap:anywhere]">
                    {item.city}
                    {item.hasHouseNumber ? '' : ' · street only'}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className="px-4 pt-2 pb-1 text-caption text-muted-foreground">
            Addresses © OpenStreetMap contributors
          </p>
        </>
      ) : state.kind === 'searching' ? (
        slow ? (
          <p className="flex items-center gap-3 p-4 text-body-5 text-neutral-3">
            <Spinner className="size-5" />
            Searching…
          </p>
        ) : null
      ) : state.kind === 'none' ? (
        <Panel icon={<SearchX className="size-5 shrink-0" aria-hidden />} text={NOT_FOUND_TEXT} />
      ) : state.kind === 'down' ? (
        <Panel
          icon={<CircleExclamationPoint className="size-5 shrink-0 text-destructive" aria-hidden />}
          text={SEARCH_DOWN_TEXT}
          action={
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onPointerDown={(event) => event.preventDefault()}
              onClick={onRetry}
              className="mt-1 -ml-4 text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
            >
              Try again
            </Button>
          }
        />
      ) : state.kind === 'offline' ? (
        <Panel
          icon={<CircleExclamationPoint className="size-5 shrink-0 text-destructive" aria-hidden />}
          text={OFFLINE_TEXT}
        />
      ) : null}
    </div>
  );
}

/**
 * The address search (design 5.5): the ARIA "list autocomplete with manual selection" pattern,
 * built on the text field. From 3 characters, suggestions are looked up through the server
 * (debounced 250 ms); the count is announced once typing pauses. Arrows move, Enter picks, Escape
 * closes (a second Escape clears), Tab closes without picking. When the browser autofills the
 * field, the best match is looked up at once and offered to confirm (S4.4).
 */
export function AddressCombobox({
  control,
  value,
  onType,
  onPick,
  disabled,
}: {
  control: FieldControlProps;
  value: string;
  /** Typed (or autofilled) text: any earlier pick no longer holds. */
  onType: (text: string) => void;
  onPick: (item: AddressSuggestion) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [confirm, setConfirm] = useState<AddressSuggestion | null>(null);
  const requestRef = useRef(0);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      clearTimeout(announceTimer.current);
    },
    [],
  );

  const slow = useSlowPending(state.kind === 'searching', SEARCHING_DELAY_MS);

  async function search(query: string, fromAutofill = false) {
    const request = ++requestRef.current;
    clearTimeout(announceTimer.current);
    if (query.trim().length < MIN_QUERY) {
      setState({ kind: 'idle' });
      setOpen(false);
      return;
    }
    if (isOffline()) {
      setState({ kind: 'offline' });
      setOpen(true);
      return;
    }
    setState({ kind: 'searching' });
    if (!fromAutofill) setOpen(true);
    const outcome = await callAction(() => searchAddressesAction({ query: query.trim() }), {
      timeoutMs: SEARCH_TIMEOUT_MS,
    });
    if (request !== requestRef.current) return;

    let next: SearchState;
    let spoken: string;
    if (outcome.ok) {
      next = outcome.data.length ? { kind: 'results', items: outcome.data } : { kind: 'none' };
      spoken = outcome.data.length ? countText(outcome.data.length) : NOT_FOUND_TEXT;
    } else if (outcome.error.code === 'OFFLINE') {
      next = { kind: 'offline' };
      spoken = OFFLINE_TEXT;
    } else if (outcome.error.code === 'INVALID_INPUT') {
      next = { kind: 'idle' };
      spoken = '';
    } else {
      next = { kind: 'down' };
      spoken = SEARCH_DOWN_TEXT;
    }
    setState(next);
    setActive(-1);

    if (fromAutofill && next.kind === 'results') {
      setConfirm(next.items[0] ?? null);
      setOpen(false);
      return;
    }
    // Once per result set, after typing has paused.
    if (spoken) announceTimer.current = setTimeout(() => announce(spoken), ANNOUNCE_DELAY_MS);
  }

  const debouncer = useDebouncer((query: string) => void search(query), { wait: 250 });

  const items = state.kind === 'results' ? state.items : [];
  const expanded = open && state.kind !== 'idle' && !(state.kind === 'searching' && !slow);

  const pick = (item: AddressSuggestion) => {
    debouncer.cancel();
    requestRef.current++;
    clearTimeout(announceTimer.current);
    setOpen(false);
    setConfirm(null);
    setActive(-1);
    onPick(item);
  };

  return (
    <div>
      <div className="relative">
        <Input
          {...control}
          ref={inputRef}
          name="address"
          // An input already; the role adds the popup semantics of the combobox pattern.
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded && items.length > 0}
          aria-controls={LISTBOX_ID}
          aria-activedescendant={expanded && active >= 0 ? `${LISTBOX_ID}-${active}` : undefined}
          autoComplete="address-line1"
          autoCapitalize="words"
          spellCheck={false}
          disabled={disabled}
          value={value}
          onChange={(event) => {
            const text = event.target.value;
            const native = event.nativeEvent;
            const inputType = native instanceof InputEvent ? native.inputType : '';
            onType(text);
            setConfirm(null);
            // Browser autofill: look it up at once and ask to confirm (S4.4).
            if (!inputType || inputType === 'insertReplacementText') {
              debouncer.cancel();
              void search(text, true);
              return;
            }
            debouncer.maybeExecute(text);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && event.altKey) {
              event.preventDefault();
              setOpen(true);
              return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (!open) setOpen(true);
              if (!items.length) return;
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setActive((current) => (current + step + items.length) % items.length);
              return;
            }
            if (event.key === 'Enter') {
              if (expanded && active >= 0 && items[active]) {
                event.preventDefault();
                pick(items[active]);
              } else if (expanded) {
                event.preventDefault();
              }
              return;
            }
            if (event.key === 'Escape') {
              if (expanded) {
                event.preventDefault();
                setOpen(false);
                setActive(-1);
              } else if (value) {
                event.preventDefault();
                onType('');
                setState({ kind: 'idle' });
              }
              return;
            }
            if (event.key === 'Tab') setOpen(false);
          }}
          onBlur={() => setOpen(false)}
          onFocus={() => {
            if (state.kind !== 'idle' && state.kind !== 'searching' && !confirm) setOpen(true);
          }}
        />
        {expanded ? (
          <Popup
            state={state}
            active={active}
            slow={slow}
            onPick={pick}
            onHover={setActive}
            onRetry={() => void search(value)}
          />
        ) : null}
      </div>
      {confirm ? (
        <div className="mt-3 rounded-xl border border-neutral-6 bg-neutral-7 p-4">
          <p className="text-body-5 text-neutral-3">Is this your address?</p>
          <p className="text-body-4 font-medium text-neutral-1 [overflow-wrap:anywhere]">
            {confirm.line1}, {confirm.city}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="touch"
              className="bg-white"
              onClick={() => pick(confirm)}
            >
              Use this address
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={() => {
                setConfirm(null);
                setOpen(true);
                inputRef.current?.focus();
              }}
            >
              Show other matches
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
