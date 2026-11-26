'use client';

import { useSelector } from '@tanstack/react-store';
import { AlarmClock, CircleCheck, Clock, Info, type LucideIcon, VolumeX } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { announce } from '@/lib/announce';
import { dismissNotice, dispatchStore, refreshSoundState } from '@/lib/partner/dispatch';
import { unlockOfferSound } from '@/lib/partner/offer-sound';
import {
  missedNotice,
  OFFER_COPY,
  type OfferNoticeIcon,
  type OfferNoticeWords,
} from '@/lib/partner/offer-text';
import { useMotion } from '@/lib/motion';
import { PartnerNotice } from '../shell';

/*
 * The offer notices (F7 design 1.7, 1.9, 1.15) in the notice slot of whichever screen shows,
 * Home or Profile, so a notice is never lost: endings leave after 6 s, what changed his job
 * stays until dismissed. Plus the 2-miss warning and the sound banner on the online home.
 */

const ICONS: Record<OfferNoticeIcon, LucideIcon> = {
  clock: Clock,
  info: Info,
  alarm: AlarmClock,
  check: CircleCheck,
};

export function OfferNotice({
  words,
  onDismiss,
}: {
  words: OfferNoticeWords;
  onDismiss?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(
    (motion) => {
      if (!ref.current) return;
      motion.from(ref.current, { y: -4, opacity: 0, duration: motion.reduced ? 0 : 0.15 });
    },
    { scope: ref, dependencies: [words.text] },
  );
  return (
    <div ref={ref}>
      <PartnerNotice tone={words.tone} icon={ICONS[words.icon]} onDismiss={onDismiss}>
        {words.text}
      </PartnerNotice>
    </div>
  );
}

/** The engine's current notice: an ending, a release, a delivery. */
export function DispatchNoticeSlot() {
  const notice = useSelector(dispatchStore, (state) => state.notice);
  if (!notice) return null;
  return <OfferNotice key={notice.id} words={notice.words} onDismiss={dismissNotice} />;
}

/** "You've missed 2 offers in a row…" until his next answer or going offline (P25.1). */
export function MissedOffersNotice() {
  const missed = useSelector(dispatchStore, (state) => state.missedInRow);
  const limit = useSelector(dispatchStore, (state) => state.howOffersWork.missLimit);
  const words = missedNotice(missed, limit);
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (words && said.current !== words.text) {
      said.current = words.text;
      announce(words.text);
    }
    if (!words) said.current = null;
  }, [words]);
  if (!words) return null;
  return <OfferNotice words={words} />;
}

/**
 * "Tap to turn on offer sounds" (P19.4): sharing resumed without a tap and the browser won't
 * play yet. The card always shows, with or without sound.
 */
export function SoundUnlockBanner() {
  const ready = useSelector(dispatchStore, (state) => state.soundReady);
  if (ready) return null;
  return (
    <button
      type="button"
      onClick={() => {
        void (async () => {
          const unlocked = await unlockOfferSound();
          refreshSoundState();
          if (unlocked) announce(OFFER_COPY.soundOn);
        })();
      }}
      className="flex min-h-12 w-full items-center gap-3 rounded-xl bg-warning-soft px-4 py-3 text-left text-body-4 font-medium text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
    >
      <VolumeX className="size-5 shrink-0 text-warning-mark" aria-hidden />
      {OFFER_COPY.soundBanner}
    </button>
  );
}
