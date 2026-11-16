'use client';

import { gsap } from 'gsap';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from '@/components/ui/carousel';
import { prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { DishPlate } from './dish-plate';

const PLATE = 'w-[85%] max-w-[416px] md:w-[84%] xl:w-[67%]';
const SIZES = '(min-width: 1280px) 416px, (min-width: 768px) 40vw, 86vw';

const panel = 'relative -mx-6 bg-neutral-7 md:mx-0 md:-ml-12 md:rounded-lg xl:-ml-[72px]';
const frame =
  'flex aspect-[375/439] items-center justify-center md:aspect-[476/732] xl:aspect-[622/791]';

/**
 * The dish photo on its plate, in a grey panel that runs to the left edge of the screen. With one
 * photo (every dish today) there is nothing to swipe and no counter; with two or more, the photos
 * become a carousel with "Previous photo" / "Next photo".
 */
export function DishGallery({ images, soldOut }: { images: string[]; soldOut: boolean }) {
  if (images.length < 2) {
    return (
      <div className={cn(panel, frame)}>
        <DishPlate
          src={images[0] ?? null}
          sizes={SIZES}
          preload
          soldOut={soldOut}
          className={PLATE}
        />
      </div>
    );
  }
  return <PhotoCarousel images={images} soldOut={soldOut} />;
}

function PhotoCarousel({ images, soldOut }: { images: string[]; soldOut: boolean }) {
  const [api, setApi] = useState<CarouselApi>();
  const [selected, setSelected] = useState(0);
  const trackId = useId();

  useEffect(() => {
    if (!api) return undefined;
    const update = () => setSelected(api.selectedScrollSnap());
    update();
    api.on('select', update);
    return () => {
      api.off('select', update);
    };
  }, [api]);

  const go = (index: number) => {
    if (!api || index < 0 || index >= images.length) return;
    const reduced = prefersReducedMotion();
    api.scrollTo(index, reduced);
    const incoming = api.slideNodes()[index];
    if (reduced && incoming) gsap.fromTo(incoming, { opacity: 0 }, { opacity: 1, duration: 0.15 });
  };

  const arrow =
    'absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-neutral-8 text-neutral-3 hover:bg-white aria-disabled:opacity-50';

  return (
    <Carousel setApi={setApi} aria-label="Photos" className={cn(panel, 'overflow-hidden')}>
      <CarouselContent id={trackId} className="ml-0">
        {images.map((image, index) => (
          <CarouselItem
            key={image}
            aria-label={`Photo ${index + 1} of ${images.length}`}
            inert={api ? index !== selected : undefined}
            className={cn(frame, 'pl-0')}
          >
            <DishPlate
              src={image}
              sizes={SIZES}
              preload={index === 0}
              soldOut={soldOut}
              className={PLATE}
            />
          </CarouselItem>
        ))}
      </CarouselContent>
      <Button
        type="button"
        size="icon-touch"
        aria-label="Previous photo"
        aria-controls={trackId}
        aria-disabled={selected === 0 || undefined}
        onClick={() => go(selected - 1)}
        className={cn(arrow, 'left-4')}
      >
        <ArrowLeft className="size-6" aria-hidden />
      </Button>
      <Button
        type="button"
        size="icon-touch"
        aria-label="Next photo"
        aria-controls={trackId}
        aria-disabled={selected === images.length - 1 || undefined}
        onClick={() => go(selected + 1)}
        className={cn(arrow, 'right-4')}
      >
        <ArrowRight className="size-6" aria-hidden />
      </Button>
      <span
        aria-hidden
        className="absolute right-5 bottom-5 inline-flex h-8 items-center rounded-sm bg-neutral-8 px-4 text-body-4 text-neutral-3 tabular-nums"
      >
        {selected + 1}/{images.length}
      </span>
    </Carousel>
  );
}
