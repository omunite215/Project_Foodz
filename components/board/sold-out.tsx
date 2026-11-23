'use client';

import { useDebouncedValue } from '@tanstack/react-pacer';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, X } from 'lucide-react';
import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import type { Cuisine } from '@/server/db/enums';
import { boardDishesAction, setDishAvailabilityAction } from '@/server/modules/board/actions';
import type { BoardDish, SoldOutDish } from '@/server/modules/board/schema';
import { BLOCKED_BUTTON_CLASS, useSlowPending } from '@/components/forms/submit-button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { soldOutSinceText, soldOutStripText } from '@/lib/board/text';
import type { BoardWriter } from '@/lib/data/board';
import { CUISINE_LABELS } from '@/lib/format';
import { cn } from '@/lib/utils';

/*
 * "86 it" (F5 design 4): marking a dish sold out stops new orders for it until someone turns it
 * back on; it never hides the dish. KITCHEN and ADMIN change it, SUPPORT only sees the strip,
 * the demo admin sees the controls disabled. Marking sold out asks first; putting a dish back
 * is immediate (D22).
 */

export const BOARD_DISHES_KEY = ['board', 'dishes'] as const;
const CUISINE_ORDER: readonly Cuisine[] = ['KOREAN', 'THAI', 'VIETNAMESE'];

/** "Sold out: Pad Thai, Naengmyeon · Manage" under the toolbar (design 4.4). */
export function SoldOutStrip({
  dishes,
  canManage,
  onManage,
}: {
  dishes: readonly SoldOutDish[];
  canManage: boolean;
  onManage: () => void;
}) {
  if (dishes.length === 0) return null;
  return (
    <div className="mx-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-tag-4-bg px-4 py-2 text-body-5 text-neutral-1 lg:mx-6">
      <Ban className="size-4 shrink-0 text-destructive" aria-hidden />
      <span className="[overflow-wrap:anywhere]">
        {soldOutStripText(dishes.map((dish) => dish.title))}
      </span>
      {canManage ? (
        <button
          type="button"
          onClick={onManage}
          className="inline-flex h-11 items-center font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          Manage
        </button>
      ) : null}
    </div>
  );
}

const dishButtonSelector = (dishId: string) => `[data-dish-button="${CSS.escape(dishId)}"]`;

function DishRow({
  dish,
  timeZone,
  canChange,
  blockedCaptionId,
  pending,
  error,
  onMarkSoldOut,
  onBackOn,
}: {
  dish: BoardDish;
  timeZone: string;
  canChange: boolean;
  blockedCaptionId: string | null;
  pending: boolean;
  error: boolean;
  onMarkSoldOut: () => void;
  onBackOn: () => void;
}) {
  const slow = useSlowPending(pending);
  const blocked = !canChange;
  const since = dish.available
    ? null
    : soldOutSinceText(dish.soldOutSince, dish.soldOutByName, timeZone);
  return (
    <li>
      {/* Wraps rather than crushing the name: the button drops under it when the row is narrow. */}
      <div className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-neutral-6 bg-white px-4 py-2">
        <div className="min-w-[8rem] flex-1">
          <p className="text-body-4 font-medium text-neutral-1 [overflow-wrap:break-word]">
            {dish.title}
          </p>
          {dish.available ? (
            <p className="text-body-5 text-neutral-3">On the menu</p>
          ) : since ? (
            <p className="text-body-5 text-neutral-3">{since}</p>
          ) : (
            // Phones hide the chip, so the line says it there.
            <p className="text-body-5 text-neutral-3 sm:hidden">Sold out</p>
          )}
        </div>
        {dish.available ? null : (
          <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-tag-4-bg px-2 text-body-5 font-medium text-neutral-1 max-sm:hidden">
            <Ban className="size-3.5 text-destructive" aria-hidden />
            Sold out
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="kitchen"
          data-dish-button={dish.dishId}
          aria-disabled={blocked || pending ? true : undefined}
          aria-describedby={blocked && blockedCaptionId ? blockedCaptionId : undefined}
          onClick={() => {
            if (blocked || pending) return;
            if (dish.available) onMarkSoldOut();
            else onBackOn();
          }}
          className={cn(
            'shrink-0',
            dish.available &&
              'border-destructive text-destructive hover:bg-tag-4-bg hover:text-destructive',
            blocked && BLOCKED_BUTTON_CLASS,
          )}
        >
          {slow ? (
            <>
              <Spinner className="motion-reduce:animate-none" />
              Saving…
            </>
          ) : dish.available ? (
            <>
              <span aria-hidden>Mark sold out</span>
              <span className="sr-only">Mark {dish.title} sold out</span>
            </>
          ) : (
            <>
              <span aria-hidden>Back on the menu</span>
              <span className="sr-only">Put {dish.title} back on the menu</span>
            </>
          )}
        </Button>
      </div>
      {error ? (
        <p className="mt-1 px-1 text-body-5 text-destructive">
          We couldn&apos;t change {dish.title}. Try again.
        </p>
      ) : null}
    </li>
  );
}

/** The "Dish availability" sheet (design 4.2, 4.3). */
export function SoldOutSheet({
  open,
  onOpenChange,
  canChange,
  readOnly,
  offline,
  timeZone,
  writer,
  syncRef,
  onSignedOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canChange: boolean;
  readOnly: boolean;
  offline: boolean;
  timeZone: string;
  writer: BoardWriter;
  /** The board calls it on `menu.availability-changed` from another device. */
  syncRef: RefObject<(() => Promise<void>) | null>;
  onSignedOut: () => void;
}) {
  const id = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, { wait: 150 });
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<BoardDish | null>(null);

  const dishes = useQuery({
    queryKey: BOARD_DISHES_KEY,
    queryFn: async () => {
      const outcome = await callAction(() => boardDishesAction({}));
      if (!outcome.ok) {
        if (outcome.error.code === 'UNAUTHENTICATED') onSignedOut();
        throw new Error(outcome.error.message);
      }
      return outcome.data.dishes;
    },
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    // eslint-disable-next-line no-param-reassign
    syncRef.current = async () => {
      await queryClient.invalidateQueries({ queryKey: BOARD_DISHES_KEY });
    };
    return () => {
      syncRef.current = null;
    };
  }, [queryClient, syncRef]);

  const blocked = !canChange || offline;
  const caption = readOnly ? 'Read-only in the demo' : offline ? "You're offline." : null;
  const captionId = caption ? `${id}-caption` : null;

  async function change(dish: BoardDish, available: boolean) {
    setPending(dish.dishId);
    setFailed(null);
    const outcome = await callAction(() =>
      setDishAvailabilityAction({ dishId: dish.dishId, available }),
    );
    setPending(null);
    if (!outcome.ok) {
      if (outcome.error.code === 'UNAUTHENTICATED') onSignedOut();
      setFailed(dish.dishId);
      return;
    }
    const since = available ? null : new Date().toISOString();
    queryClient.setQueryData<BoardDish[]>(BOARD_DISHES_KEY, (current) =>
      current?.map((item) =>
        item.dishId === dish.dishId
          ? {
              ...item,
              available,
              soldOutSince: since,
              soldOutByName: available ? null : item.soldOutByName,
            }
          : item,
      ),
    );
    writer.updateMeta((meta) => ({
      ...meta,
      soldOut: available
        ? meta.soldOut.filter((item) => item.dishId !== dish.dishId)
        : [...meta.soldOut, { dishId: dish.dishId, title: dish.title, since, byName: null }],
    }));
    writer.markDish(dish.dishId, !available);
    void queryClient.invalidateQueries({ queryKey: BOARD_DISHES_KEY });
    announce(available ? `${dish.title} is back on the menu.` : `${dish.title} marked sold out.`);
    // Focus stays with the same dish, whose row may have moved to the other section.
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(dishButtonSelector(dish.dishId))?.focus(),
    );
  }

  const all = dishes.data ?? [];
  const query = debounced.trim().toLowerCase();
  const matching = query ? all.filter((dish) => dish.title.toLowerCase().includes(query)) : all;
  const soldOut = matching.filter((dish) => !dish.available);
  const onMenu = matching.filter((dish) => dish.available);

  const row = (dish: BoardDish) => (
    <DishRow
      key={dish.dishId}
      dish={dish}
      timeZone={timeZone}
      canChange={!blocked}
      blockedCaptionId={captionId}
      pending={pending === dish.dishId}
      error={failed === dish.dishId}
      onMarkSoldOut={() => setConfirm(dish)}
      onBackOn={() => void change(dish, true)}
    />
  );

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          aria-describedby={`${id}-description`}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef.current?.focus();
          }}
          className="inset-y-0 right-0 h-full w-full bg-background shadow-raised md:w-[420px] motion-safe:data-[state=closed]:slide-out-to-right motion-safe:data-[state=open]:slide-in-from-right max-md:motion-safe:data-[state=open]:slide-in-from-bottom-6"
        >
          <header className="relative border-b border-neutral-6 px-6 pt-6 pb-4 pr-16">
            <SheetTitle
              ref={titleRef}
              tabIndex={-1}
              className="font-heading text-title-1 text-neutral-2 outline-none"
            >
              Dish availability
            </SheetTitle>
            <SheetDescription id={`${id}-description`} className="mt-1 text-body-5 text-neutral-3">
              Sold-out dishes can&apos;t be ordered until you turn them back on. The menu updates
              within a minute.
            </SheetDescription>
            {caption ? (
              <p id={captionId ?? undefined} className="mt-2 text-caption text-neutral-3">
                {caption}
              </p>
            ) : null}
            <SheetClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-kitchen"
                aria-label="Close"
                className="absolute top-4 right-4"
              >
                <X className="size-5" aria-hidden />
              </Button>
            </SheetClose>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-4 pt-4">
              <label htmlFor={`${id}-find`} className="block text-body-4 text-neutral-3">
                Find a dish
              </label>
              <Input
                id={`${id}-find`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                autoComplete="off"
                className="mt-2 h-12"
              />
            </div>
            <div className="space-y-6 px-4 py-4" aria-busy={dishes.isPending || undefined}>
              {dishes.isError ? (
                <p className="text-body-5 text-destructive">
                  We couldn&apos;t load the dishes. Close this and try again.
                </p>
              ) : null}
              {query && matching.length === 0 && dishes.isSuccess ? (
                <p className="text-body-5 text-neutral-3">
                  No dish matches &ldquo;{debounced.trim()}&rdquo;.
                </p>
              ) : null}
              {soldOut.length > 0 ? (
                <section aria-labelledby={`${id}-sold-out`}>
                  <h3 id={`${id}-sold-out`} className="text-body-4 font-semibold text-neutral-1">
                    Sold out ({soldOut.length})
                  </h3>
                  <ul className="mt-3 space-y-2">{soldOut.map(row)}</ul>
                </section>
              ) : null}
              {onMenu.length > 0 ? (
                <section aria-labelledby={`${id}-on-menu`}>
                  <h3 id={`${id}-on-menu`} className="text-body-4 font-semibold text-neutral-1">
                    On the menu
                  </h3>
                  {CUISINE_ORDER.map((cuisine) => {
                    const group = onMenu.filter((dish) => dish.cuisine === cuisine);
                    if (group.length === 0) return null;
                    return (
                      <div key={cuisine} className="mt-4">
                        <h4 className="text-body-5 font-medium text-neutral-3">
                          {CUISINE_LABELS[cuisine]}
                        </h4>
                        <ul className="mt-2 space-y-2">{group.map(row)}</ul>
                      </div>
                    );
                  })}
                </section>
              ) : null}
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <AlertDialog open={confirm !== null} onOpenChange={(next) => !next && setConfirm(null)}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            const dish = confirm;
            if (!dish) return;
            event.preventDefault();
            document.querySelector<HTMLElement>(dishButtonSelector(dish.dishId))?.focus();
          }}
        >
          <AlertDialogTitle>Mark {confirm?.title} sold out?</AlertDialogTitle>
          <AlertDialogDescription>
            Customers can&apos;t order it until someone turns it back on. Orders already placed
            aren&apos;t changed.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel size="kitchen">Keep it on</AlertDialogCancel>
            <ConfirmSoldOut
              onConfirm={async () => {
                const dish = confirm;
                if (!dish) return;
                await change(dish, false);
                setConfirm(null);
              }}
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ConfirmSoldOut({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const slow = useSlowPending(pending);
  return (
    <Button
      type="button"
      variant="danger"
      size="kitchen"
      aria-disabled={pending || undefined}
      onClick={() => {
        if (pending) return;
        setPending(true);
        void onConfirm().finally(() => setPending(false));
      }}
    >
      {slow ? (
        <>
          <Spinner className="motion-reduce:animate-none" />
          Saving…
        </>
      ) : (
        'Mark sold out'
      )}
    </Button>
  );
}
