'use client';

import {
  EyeOff,
  IdCard,
  ImageOff,
  Maximize2,
  Trash2,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { partnerDocumentLinkAction } from '@/server/modules/partners/review-actions';
import type { ImageState, PartnerReview } from '@/server/modules/partners/review-schema';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { callAction } from '@/lib/action-result';
import { idAlt, idCaption, photoAlt, weekdayDateOf } from '@/lib/partner-review/text';
import { needsFreshLink } from '@/lib/partner-review/viewer';
import { DocumentViewer, type ViewerLink } from './document-viewer';
import { ChangedChip } from './parts';

/*
 * Photo and ID (F6 design 8.6, A21): each image in its own box, at its size, in whatever state
 * the server says, never a broken-image icon. Links last 5 minutes; when an image must load
 * again the page asks for a fresh one by itself, and says it expired only if that fails too.
 * Either image opens the viewer, so faces can be compared at 200% (D30).
 */

type Kind = 'photo' | 'idFront';

type LocalState =
  | { state: 'ready'; link: ViewerLink }
  | { state: 'loading' }
  | { state: 'expired' }
  | { state: 'failed' }
  | Exclude<ImageState, { state: 'ready' }>;

const fromServer = (image: ImageState): LocalState =>
  image.state === 'ready'
    ? { state: 'ready', link: { url: image.url, expiresAt: image.expiresAt } }
    : image;

/** Keeps a still-valid link across the 30-second refreshes, so the image doesn't reload. */
function useImage(partnerId: string, kind: Kind, server: ImageState) {
  const [local, setLocal] = useState<LocalState>(() => fromServer(server));
  const [seen, setSeen] = useState(server);
  if (server !== seen) {
    setSeen(server);
    // A link already on screen stays; the image asks for a fresh one if it fails to load.
    const keep = local.state === 'ready' && server.state === 'ready';
    if (!keep) setLocal(fromServer(server));
  }

  const freshLink = async (): Promise<ViewerLink | null> => {
    const outcome = await callAction(() => partnerDocumentLinkAction({ partnerId, kind }));
    if (!outcome.ok) return null;
    const data = outcome.data;
    if ('url' in data) return { url: data.url, expiresAt: data.expiresAt };
    return null;
  };

  const renewed = useRef<string | null>(null);
  const renew = async (failed: 'expired' | 'failed') => {
    setLocal({ state: 'loading' });
    const outcome = await callAction(() => partnerDocumentLinkAction({ partnerId, kind }));
    if (!outcome.ok) {
      setLocal({ state: failed });
      return;
    }
    const data = outcome.data;
    if ('url' in data) {
      renewed.current = data.url;
      setLocal({ state: 'ready', link: { url: data.url, expiresAt: data.expiresAt } });
    } else {
      setLocal(fromServer(data));
    }
  };

  /** A load failed: ask for a fresh link once; if that one fails too, say so. */
  const onError = () => {
    if (local.state === 'ready' && local.link.url === renewed.current) {
      setLocal({ state: 'failed' });
      return;
    }
    void renew(
      local.state === 'ready' && needsFreshLink(local.link.expiresAt, Date.now())
        ? 'expired'
        : 'failed',
    );
  };

  return { local, setLocal, freshLink, renew, onError };
}

const STATE_BOX = 'flex size-full flex-col items-center justify-center gap-2 p-4 text-center';

function ImageStateContent({
  local,
  round,
  noneText,
  onRetry,
}: {
  local: LocalState;
  round: boolean;
  noneText: string;
  onRetry: (failed: 'expired' | 'failed') => void;
}) {
  const textClass = round ? 'text-caption text-neutral-1' : 'text-body-5 text-neutral-1';
  switch (local.state) {
    case 'loading':
      return (
        <span className="block size-full motion-safe:animate-skeleton">
          <span className="sr-only">Loading image</span>
        </span>
      );
    case 'expired':
    case 'failed':
      return (
        <div className={STATE_BOX}>
          <ImageOff className="size-6 text-neutral-3" aria-hidden />
          <p className={textClass}>
            {local.state === 'expired' ? 'This link has expired.' : "The image couldn't load."}
          </p>
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="bg-white"
            onClick={() => onRetry(local.state === 'expired' ? 'expired' : 'failed')}
          >
            Show again
          </Button>
        </div>
      );
    case 'missing':
      return (
        <div className={STATE_BOX}>
          <TriangleAlert className="size-6 text-destructive" aria-hidden />
          <p className={textClass}>
            This image is missing from storage. Send the application back to ask for a new one.
          </p>
        </div>
      );
    case 'checking':
      return (
        <div className={STATE_BOX}>
          <Spinner className="size-6 text-neutral-3 motion-reduce:animate-none" />
          <p className={textClass}>The new photo is still being checked.</p>
        </div>
      );
    case 'masked':
      return (
        <div className={STATE_BOX}>
          <EyeOff className="size-6 text-neutral-3" aria-hidden />
          <p className={textClass}>Hidden for demo staff</p>
        </div>
      );
    default:
      return (
        <div className={STATE_BOX}>
          {round ? (
            <UserRound className="size-6 text-neutral-3" aria-hidden />
          ) : (
            <IdCard className="size-6 text-neutral-3" aria-hidden />
          )}
          <p className={textClass}>{noneText}</p>
        </div>
      );
  }
}

export function PartnerImages({ review, timeZone }: { review: PartnerReview; timeZone: string }) {
  const photo = useImage(review.partnerId, 'photo', review.images.photo);
  const idFront = useImage(review.partnerId, 'idFront', review.images.idFront);
  const [viewer, setViewer] = useState<Kind | null>(null);
  // Escape and Close return focus to the image that opened the viewer (design 9).
  const openers = useRef<Record<Kind, HTMLButtonElement | null>>({ photo: null, idFront: null });
  const type = review.document?.type ?? 'DRIVER_LICENSE';
  const last4 = review.document?.last4 ?? null;
  const changed = new Set(review.changedParts);

  const deleted = review.images.photo.state === 'deleted' ? review.images.photo : null;
  if (deleted) {
    return (
      <div className="mt-3 flex gap-3 rounded-xl bg-neutral-7 p-5 text-body-4 text-neutral-1">
        <Trash2 className="mt-0.5 size-5 shrink-0 text-neutral-3" aria-hidden />
        <p>
          Photos and ID details were deleted on {weekdayDateOf(deleted.deletedAt, timeZone)}, 30
          days after the decision.
        </p>
      </div>
    );
  }

  const viewing = viewer === 'photo' ? photo : viewer === 'idFront' ? idFront : null;
  const viewerLink = viewing?.local.state === 'ready' ? viewing.local.link : null;

  return (
    <>
      <div className="mt-3 flex flex-wrap items-start gap-6">
        <figure className="shrink-0">
          {photo.local.state === 'ready' ? (
            <button
              type="button"
              aria-label={`Open ${photoAlt(review.name).replace(/^P/, 'p')}`}
              ref={(element) => {
                openers.current.photo = element;
              }}
              onClick={() => setViewer('photo')}
              className="block size-40 overflow-hidden rounded-full bg-neutral-7 ring-1 ring-neutral-6 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
            >
              {/* A 5-minute private link: drawn as is, never through the image optimizer. */}
              {/* oxlint-disable-next-line nextjs/no-img-element */}
              <img
                src={photo.local.link.url}
                alt={photoAlt(review.name)}
                referrerPolicy="no-referrer"
                onError={photo.onError}
                className="size-full object-cover"
              />
            </button>
          ) : (
            <div className="size-40 overflow-hidden rounded-full bg-neutral-7 ring-1 ring-neutral-6">
              <ImageStateContent
                local={photo.local}
                round
                noneText="No photo on file (demo account)"
                onRetry={(failed) => void photo.renew(failed)}
              />
            </div>
          )}
          <figcaption className="mt-2 flex flex-col items-center gap-1 text-center text-body-5 text-neutral-3">
            Profile photo
            {changed.has('photo') ? <ChangedChip /> : null}
          </figcaption>
        </figure>

        <figure className="w-full max-w-[480px]">
          {idFront.local.state === 'ready' ? (
            <button
              type="button"
              aria-label={`Open ${idAlt(review.name, type).replace(/^F/, 'f')}`}
              ref={(element) => {
                openers.current.idFront = element;
              }}
              onClick={() => setViewer('idFront')}
              className="relative block aspect-[1.586] w-full overflow-hidden rounded-xl border border-neutral-6 bg-neutral-7 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
            >
              {/* oxlint-disable-next-line nextjs/no-img-element */}
              <img
                src={idFront.local.link.url}
                alt={idAlt(review.name, type)}
                referrerPolicy="no-referrer"
                onError={idFront.onError}
                className="size-full object-contain"
              />
              <span
                aria-hidden
                className="absolute top-2 right-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/95 px-3 text-body-5 font-medium text-neutral-1 shadow-card"
              >
                <Maximize2 className="size-4" />
                Open
              </span>
            </button>
          ) : (
            <div className="aspect-[1.586] w-full overflow-hidden rounded-xl border border-neutral-6 bg-neutral-7">
              <ImageStateContent
                local={idFront.local}
                round={false}
                noneText="No ID on file (demo account)"
                onRetry={(failed) => void idFront.renew(failed)}
              />
            </div>
          )}
          <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-body-5 text-neutral-3">
            {idCaption(type, last4)}
            {changed.has('idPhoto') ? <ChangedChip /> : null}
          </figcaption>
        </figure>
      </div>
      <DocumentViewer
        open={viewer !== null}
        title={viewer === 'photo' ? photoAlt(review.name) : idAlt(review.name, type)}
        alt={viewer === 'photo' ? photoAlt(review.name) : idAlt(review.name, type)}
        link={viewerLink}
        onFreshLink={async () => {
          const fresh = await (viewing?.freshLink() ?? Promise.resolve(null));
          if (fresh && viewing) viewing.setLocal({ state: 'ready', link: fresh });
          return fresh;
        }}
        onClose={() => {
          const opener = viewer ? openers.current[viewer] : null;
          setViewer(null);
          requestAnimationFrame(() => opener?.focus());
        }}
      />
    </>
  );
}
