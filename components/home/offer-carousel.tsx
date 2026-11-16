'use client';

import { gsap } from 'gsap';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from '@/components/ui/carousel';
import { prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface OfferCarouselProps {
  /** Names the carousel region: "Today's special offers", "Offers". */
  label: string;
  slides: { key: string; content: ReactNode }[];
  slideClassName?: string;
  className?: string;
  controlsClassName?: string;
}

const arrowClass =
  'rounded-full border-2 border-neutral-6 bg-transparent text-neutral-3 hover:bg-neutral-7 aria-disabled:cursor-default aria-disabled:border-transparent aria-disabled:text-neutral-5 aria-disabled:hover:bg-transparent';

/**
 * Offers one at a time, moved only by the visitor (arrows or swipe; never on its own). Slides
 * out of view cannot be focused, the arrows are named "Previous offer" / "Next offer", and the
 * position ("2 of 3") is announced when it changes. Under reduced motion slides change without
 * sliding: the new one fades in.
 */
export function OfferCarousel({
  label,
  slides,
  slideClassName,
  className,
  controlsClassName,
}: OfferCarouselProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [selected, setSelected] = useState(0);
  const trackId = useId();
  const total = slides.length;

  useEffect(() => {
    if (!api) return undefined;
    const update = () => setSelected(api.selectedScrollSnap());
    update();
    api.on('select', update).on('reInit', update);
    return () => {
      api.off('select', update).off('reInit', update);
    };
  }, [api]);

  const go = (index: number) => {
    if (!api || index < 0 || index >= total) return;
    const reduced = prefersReducedMotion();
    api.scrollTo(index, reduced);
    const incoming = api.slideNodes()[index];
    if (reduced && incoming) gsap.fromTo(incoming, { opacity: 0 }, { opacity: 1, duration: 0.15 });
  };

  const atStart = selected === 0;
  const atEnd = selected >= total - 1;

  return (
    <Carousel
      setApi={setApi}
      opts={{ align: 'center', containScroll: false }}
      aria-label={label}
      className={className}
      // Same path as the arrows, so the keyboard also respects reduced motion.
      onKeyDownCapture={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        go(event.key === 'ArrowLeft' ? selected - 1 : selected + 1);
      }}
    >
      <CarouselContent id={trackId} className="items-stretch">
        {slides.map((slide, index) => (
          <CarouselItem
            key={slide.key}
            aria-label={`${index + 1} of ${total}`}
            // Before the carousel starts every slide is reachable; after, only the one in view.
            inert={api ? index !== selected : undefined}
            className={cn('flex', slideClassName)}
          >
            {slide.content}
          </CarouselItem>
        ))}
      </CarouselContent>
      <div className={cn('mt-8 flex items-center justify-center gap-2', controlsClassName)}>
        <Button
          type="button"
          variant="outline"
          size="icon-touch"
          aria-label="Previous offer"
          aria-controls={trackId}
          aria-disabled={atStart || undefined}
          onClick={() => go(selected - 1)}
          className={arrowClass}
        >
          <ArrowLeft className="size-6" aria-hidden />
        </Button>
        <p
          aria-live="polite"
          className="min-w-14 text-center text-body-5 text-neutral-3 tabular-nums"
        >
          {selected + 1} of {total}
        </p>
        <Button
          type="button"
          variant="outline"
          size="icon-touch"
          aria-label="Next offer"
          aria-controls={trackId}
          aria-disabled={atEnd || undefined}
          onClick={() => go(selected + 1)}
          className={arrowClass}
        >
          <ArrowRight className="size-6" aria-hidden />
        </Button>
      </div>
    </Carousel>
  );
}
