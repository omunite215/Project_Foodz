'use client';

import { useSelector } from '@tanstack/react-store';
import { useEffect, useRef, useState } from 'react';
import {
  acceptOffer,
  backToWaiting,
  declineOffer,
  dispatchStore,
  type OfferCard,
  silenceOffer,
} from '@/lib/partner/dispatch';
import { sharingStore } from '@/lib/partner/sharing';
import { prefersReducedMotion } from '@/lib/motion';
import { useOnline } from '@/lib/use-online';
import { usePartnerTheme } from '../partner-root';
import { OfferCardView } from './offer-card';

/*
 * Where an offer shows (F7 design 1.1): above every partner screen, sheet and dialog, in the
 * partner root; only the suspension cover is above it. While it's open the status bar takes
 * the band's color. When it closes, focus goes to the page's h1, or to the pick-up screen's
 * after an accept (design, Focus).
 */

const BAND_COLORS = {
  offer: { light: '#02630a', dark: '#03850a' },
  practice: { light: '#3304b9', dark: '#3304b9' },
} as const;

/** True while an offer card covers the screen: the page behind is inert. */
export function useOfferOpen(): boolean {
  return useSelector(dispatchStore, (state) => state.card !== null);
}

function focusAfterClose(how: 'ended' | 'accepted' | 'declined' | 'waiting') {
  requestAnimationFrame(() => {
    const target =
      how === 'accepted'
        ? document.querySelector<HTMLElement>('[data-pickup-h1]')
        : document.querySelector<HTMLElement>('[data-partner-h1]');
    target?.focus({ preventScroll: false });
  });
}

export function OfferLayer() {
  const card = useSelector(dispatchStore, (state) => state.card);
  const offset = useSelector(dispatchStore, (state) => state.offset);
  const lastClose = useSelector(dispatchStore, (state) => state.lastClose);
  const pinned = useSelector(sharingStore, (state) => state.pinned);
  const online = useOnline();
  const { resolved } = usePartnerTheme();
  const [previous, setPrevious] = useState<OfferCard | null>(card);
  const [leaving, setLeaving] = useState<OfferCard | null>(null);

  // The card fades out over 160 ms after it closes (removed at once under reduced motion).
  if (card !== previous) {
    setPrevious(card);
    if (card) setLeaving(null);
    else if (previous && !prefersReducedMotion()) setLeaving(previous);
  }
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(() => setLeaving(null), 180);
    return () => clearTimeout(timer);
  }, [leaving]);

  const seenClose = useRef(lastClose?.id ?? 0);
  useEffect(() => {
    if (!lastClose || lastClose.id === seenClose.current) return;
    seenClose.current = lastClose.id;
    focusAfterClose(lastClose.how);
  }, [lastClose]);

  // The status bar takes the band's color while the card is open (design 1.1).
  const practice = card?.detail?.kind === 'practice';
  const open = card !== null;
  useEffect(() => {
    if (!open) return undefined;
    const colors = practice ? BAND_COLORS.practice : BAND_COLORS.offer;
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    const before = [...metas].map((meta) => meta.content);
    metas.forEach((meta) => {
      const media = meta.getAttribute('media') ?? '';
      const darkMeta = media.includes('dark') || (!media && resolved === 'dark');
      meta.content = darkMeta ? colors.dark : colors.light;
    });
    return () => metas.forEach((meta, index) => (meta.content = before[index] ?? meta.content));
  }, [open, practice, resolved]);

  const visible = card ?? leaving;
  if (!visible) return null;
  return (
    <OfferCardView
      key={visible.offerId}
      card={visible}
      offset={offset}
      noConnection={!online || pinned === 'noConnection'}
      exiting={!card}
      onAccept={acceptOffer}
      onDecline={declineOffer}
      onBackToWaiting={backToWaiting}
      onTouch={silenceOffer}
    />
  );
}
