'use client';

import { gsap } from 'gsap';
import { Draggable } from 'gsap/Draggable';
import { Check, ChevronsRight } from 'lucide-react';
import { type MouseEvent, useEffect, useId, useRef, useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { announce } from '@/lib/announce';
import { OFFER_COPY } from '@/lib/partner/offer-text';
import { NO_TAP, nextTap, TAP_WINDOW_MS, type TapState } from '@/lib/partner/slide-tap';
import { prefersReducedMotion, useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

gsap.registerPlugin(Draggable);

/*
 * Slide to accept (F7 design 1.5, P22): one button drawn as a track with a handle. Sliding the
 * handle past 80% of the track accepts; earlier, it springs back. A pointer tap without a drag
 * arms "Tap again to accept" for 3 seconds (U13). Enter, Space or an assistive activation (a
 * click with no pointer down before it) accepts at once (P22.3). Nothing needs a long press,
 * two hands or a pinch; the track is 56 px tall and the handle 56 × 56.
 */

export type SlideState = 'ready' | 'blocked' | 'accepting' | 'waiting' | 'accepted';

export const ACCEPT_AT = 0.8;

export function SlideToAccept({
  state,
  name,
  describedBy,
  acceptedLabel,
  onAccept,
  onTouch,
}: {
  state: SlideState;
  /** "Accept order, earn $7.64". */
  name: string;
  describedBy: string;
  /** "Order 1042 is yours". */
  acceptedLabel?: string;
  onAccept: () => void;
  /** The first touch silences the offer's sound (P19.2). */
  onTouch: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const handleRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const draggable = useRef<Draggable | null>(null);
  // One tap path for every caller (review B1): the arm is a time, taken at once.
  const taps = useRef<TapState>(NO_TAP);
  const [armed, setArmed] = useState(false);
  const labelId = useId();
  const ready = state === 'ready';
  const busy = state === 'accepting' || state === 'waiting' || state === 'accepted';

  const latest = useRef({ ready, onAccept });
  useEffect(() => {
    latest.current = { ready, onAccept };
  });

  // The 3-second window of "Tap again to accept".
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => {
      taps.current = { ...taps.current, armedAt: null };
      setArmed(false);
    }, TAP_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  const maxX = () => {
    const button = buttonRef.current;
    const handle = handleRef.current;
    return button && handle ? Math.max(0, button.clientWidth - handle.offsetWidth) : 0;
  };

  const showProgress = (x: number) => {
    const end = maxX();
    const progress = end > 0 ? Math.min(1, Math.max(0, x / end)) : 0;
    if (fillRef.current) gsap.set(fillRef.current, { scaleX: progress });
    if (labelRef.current) gsap.set(labelRef.current, { opacity: Math.max(0, 1 - progress / 0.6) });
  };

  const springBack = () => {
    const handle = handleRef.current;
    if (!handle) return;
    const reduced = prefersReducedMotion();
    gsap.to(handle, {
      x: 0,
      duration: reduced ? 0 : 0.24,
      ease: 'power2.out',
      onUpdate: () => showProgress(Number(gsap.getProperty(handle, 'x'))),
      onComplete: () => showProgress(0),
    });
  };

  const tap = () => {
    if (!latest.current.ready) return;
    const next = nextTap(taps.current, performance.now());
    taps.current = next.state;
    if (next.outcome === 'ignore') return;
    if (next.outcome === 'accept') {
      setArmed(false);
      latest.current.onAccept();
      return;
    }
    setArmed(true);
    announce(OFFER_COPY.tapAgain);
    const handle = handleRef.current;
    if (handle && !prefersReducedMotion()) {
      gsap.fromTo(
        handle,
        { x: 0 },
        { x: 8, duration: 0.12, ease: 'power1.out', yoyo: true, repeat: 1 },
      );
    }
  };

  // The handle follows the thumb on x only, inside the track (Draggable).
  useEffect(() => {
    const handle = handleRef.current;
    const button = buttonRef.current;
    if (!handle || !button) return undefined;
    const [created] = Draggable.create(handle, {
      type: 'x',
      bounds: button,
      minimumMovement: 4,
      allowNativeTouchScrolling: false,
      zIndexBoost: false,
      onDrag() {
        showProgress(this.x);
      },
      onRelease() {
        if (!latest.current.ready) return;
        const end = maxX();
        // Where the handle was let go decides; a press without a drag stays at 0 (a tap).
        const x = Number(gsap.getProperty(handle, 'x'));
        if (end > 0 && x >= end * ACCEPT_AT) {
          gsap.set(handle, { x: end });
          showProgress(end);
          latest.current.onAccept();
        } else if (x > 0) {
          springBack();
        }
      },
      // The handle's own taps take the same path; one press reported twice counts once.
      onClick: () => tap(),
    });
    draggable.current = created ?? null;
    return () => {
      created?.kill();
      draggable.current = null;
    };
    // Created once; the callbacks read the latest state through refs.
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  // Only a ready slider moves; once busy the handle sits at the end.
  useEffect(() => {
    const instance = draggable.current;
    const handle = handleRef.current;
    if (!instance || !handle) return;
    if (ready) instance.enable();
    else instance.disable();
    if (busy) {
      const end = maxX();
      gsap.set(handle, { x: end });
      if (labelRef.current) gsap.set(labelRef.current, { opacity: 1 });
    }
    if (state === 'blocked' || (ready && !armed)) {
      // Back at the start (a refused accept springs back).
      if (Number(gsap.getProperty(handle, 'x')) > 0 && ready) springBack();
    }
    // oxlint-disable-next-line react/exhaustive-deps
  }, [state]);

  // Accepted: the fill completes, then the check pops in (150 ms, then 200 ms).
  useMotion(
    (motion) => {
      if (state !== 'accepted') return;
      const fill = fillRef.current;
      const check = handleRef.current?.querySelector('[data-check]');
      if (motion.reduced) {
        if (fill) gsap.set(fill, { scaleX: 1 });
        return;
      }
      const timeline = gsap.timeline();
      if (fill) timeline.to(fill, { scaleX: 1, duration: 0.15, ease: 'power2.out' });
      if (check) {
        timeline.fromTo(check, { scale: 0.6 }, { scale: 1, duration: 0.2, ease: 'back.out(2)' });
      }
    },
    { scope: buttonRef, dependencies: [state] },
  );

  const label =
    state === 'blocked'
      ? OFFER_COPY.loading
      : state === 'accepting'
        ? OFFER_COPY.accepting
        : state === 'waiting'
          ? OFFER_COPY.acceptingOffline
          : state === 'accepted'
            ? (acceptedLabel ?? OFFER_COPY.accepting)
            : armed
              ? OFFER_COPY.tapAgain
              : OFFER_COPY.slide;

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (state === 'blocked') {
      announce(OFFER_COPY.loading);
      return;
    }
    if (!ready) return;
    // A keyboard or assistive activation has no pointer behind it: it accepts at once.
    if (event.detail === 0) {
      onAccept();
      return;
    }
    tap();
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      // The visible words come first, so speech input finds it by what it says (WCAG 2.5.3).
      aria-label={state === 'blocked' ? undefined : `${label}, ${name}`}
      aria-labelledby={state === 'blocked' ? labelId : undefined}
      aria-describedby={describedBy}
      aria-disabled={!ready || undefined}
      data-state={state}
      onPointerDown={onTouch}
      onClick={onClick}
      className={cn(
        'relative flex min-h-14 w-full touch-pan-y items-center overflow-hidden rounded-full select-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
        state === 'blocked'
          ? 'cursor-not-allowed border border-border bg-muted text-muted-foreground'
          : 'bg-primary text-primary-foreground',
        busy && 'cursor-progress',
      )}
    >
      <span
        ref={fillRef}
        aria-hidden
        className="absolute inset-0 origin-left scale-x-0 bg-black/15 dark:bg-white/15"
      />
      <span
        ref={handleRef}
        aria-hidden
        className={cn(
          'absolute top-0 left-0 z-10 flex size-14 cursor-grab touch-none items-center justify-center rounded-full bg-card shadow-raised active:cursor-grabbing dark:bg-neutral-1',
          state === 'blocked' && 'hidden',
        )}
      >
        {state === 'accepting' || state === 'waiting' ? (
          <Spinner className="size-5 text-primary motion-reduce:animate-none" />
        ) : state === 'accepted' ? (
          <Check data-check="" className="size-6 text-primary" strokeWidth={3} />
        ) : (
          <ChevronsRight className="size-6 text-primary" />
        )}
      </span>
      <span
        ref={labelRef}
        id={labelId}
        className="relative mx-auto px-16 py-2 text-center text-body-3 font-semibold"
      >
        {label}
      </span>
    </button>
  );
}
