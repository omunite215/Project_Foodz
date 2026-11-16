'use client';

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Image from 'next/image';
import { useRef, useState } from 'react';
import { PlaceholderPlate } from '@/components/dish/dish-plate';
import { useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger);

const SIZES =
  '(min-width: 1440px) 553px, (min-width: 1280px) 480px, (min-width: 1024px) 326px, (min-width: 768px) 260px, 202px';

/**
 * The hero dish. It settles with a small turn when the page opens and turns a quarter as the
 * hero scrolls away; it never spins on its own, and under reduced motion it does not move.
 * It is the page's largest image, so it is preloaded and never faded in.
 */
export function HeroBowl({ src, className }: { src: string; className?: string }) {
  const settleRef = useRef<HTMLDivElement>(null);
  const turnRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useMotion(
    (motion) => {
      const settle = settleRef.current;
      const turn = turnRef.current;
      if (motion.reduced || !settle || !turn) return;
      gsap.from(settle, { rotation: -20, duration: 0.6, ease: 'power3.out' });
      gsap.to(turn, {
        rotation: 90,
        ease: 'none',
        scrollTrigger: {
          trigger: turn.closest('section') ?? turn,
          start: 'top top',
          end: 'bottom top',
          scrub: 0.5,
        },
      });
    },
    { scope: settleRef },
  );

  return (
    <div
      ref={settleRef}
      data-hero-dish
      aria-hidden
      className={cn(
        'relative aspect-square w-[202px] md:w-[260px] lg:w-[326px] xl:w-[480px] min-[1440px]:w-[553px]',
        className,
      )}
    >
      <div ref={turnRef} className="absolute inset-0">
        {failed ? (
          <PlaceholderPlate className="size-full" />
        ) : (
          <Image
            src={src}
            alt=""
            fill
            preload
            sizes={SIZES}
            onError={() => setFailed(true)}
            className="object-contain"
          />
        )}
      </div>
    </div>
  );
}
