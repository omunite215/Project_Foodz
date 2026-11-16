'use client';

import { Soup } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface DishPlateProps {
  /** The dish photo (a cut-out on a transparent background), or null for the placeholder plate. */
  src: string | null;
  /** The `sizes` attribute for the photo; the plate's own size comes from `className`. */
  sizes: string;
  className?: string;
  soldOut?: boolean;
  /** The page's largest image: fetched before anything else and never faded in. */
  preload?: boolean;
  eager?: boolean;
}

/** The plate drawn when a dish has no photo yet, or its photo fails to load. */
export function PlaceholderPlate({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative block aspect-square rounded-full bg-white shadow-card ring-1 ring-neutral-6',
        className,
      )}
    >
      <span className="absolute inset-[14%] flex items-center justify-center rounded-full bg-neutral-7">
        <Soup className="size-[38%] text-neutral-5" strokeWidth={1.5} />
      </span>
    </span>
  );
}

type PhotoState = 'server' | 'loading' | 'loaded' | 'failed';

/**
 * A dish on its round plate. The square is reserved before the photo arrives, so nothing moves
 * when it does. Dishes without a photo, and photos that fail to load, get the placeholder plate
 * at exactly the same size. The photo is decorative (`alt=""`): the dish name is always next to it.
 */
export function DishPlate({ src, sizes, className, soldOut, preload, eager }: DishPlateProps) {
  const [state, setState] = useState<PhotoState>('server');
  const imageRef = useRef<HTMLImageElement>(null);

  // Photos still loading once the page is interactive fade in; ones already there stay put.
  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    if (!image.complete) setState((current) => (current === 'server' ? 'loading' : current));
    else if (image.naturalWidth === 0) setState('failed');
    else setState('loaded');
  }, []);

  const wrapper = cn(
    'relative block aspect-square shrink-0 rounded-full',
    soldOut && 'opacity-60 grayscale',
    className,
  );

  if (!src || state === 'failed') {
    return <PlaceholderPlate className={wrapper} />;
  }

  return (
    <span aria-hidden className={cn(wrapper, state !== 'loaded' && 'bg-neutral-7')}>
      <Image
        ref={imageRef}
        src={src}
        alt=""
        fill
        sizes={sizes}
        preload={preload}
        loading={preload ? undefined : eager ? 'eager' : 'lazy'}
        onLoad={() => setState('loaded')}
        onError={() => setState('failed')}
        className={cn(
          'object-contain transition-opacity duration-200',
          state === 'loading' && !preload ? 'opacity-0' : 'opacity-100',
        )}
      />
    </span>
  );
}
