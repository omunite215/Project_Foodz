'use client';

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { type ReactNode, useRef } from 'react';
import { useMotion } from '@/lib/motion';

gsap.registerPlugin(ScrollTrigger);

/**
 * Fades a Home section up as it scrolls into view, once. Sections already on screen when the
 * page opens are left alone (they may hold the largest image), and under reduced motion nothing
 * is set up: the content is simply there.
 *
 * Inside, `data-reveal="item"` children follow in a stagger, `data-reveal="slide"` slides in from
 * the left and `data-reveal="pop"` grows in.
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useMotion(
    (motion) => {
      const root = ref.current;
      if (motion.reduced || !root) return;
      if (root.getBoundingClientRect().top < window.innerHeight) return;

      const timeline = gsap.timeline({
        scrollTrigger: { trigger: root, start: 'top 85%', once: true },
        defaults: { ease: 'power2.out' },
      });
      timeline.from(root, { y: 24, opacity: 0, duration: 0.45 });
      const items = root.querySelectorAll('[data-reveal="item"]');
      if (items.length > 0) {
        timeline.from(items, { y: 24, opacity: 0, duration: 0.45, stagger: 0.08 }, '<0.1');
      }
      const slides = root.querySelectorAll('[data-reveal="slide"]');
      if (slides.length > 0) timeline.from(slides, { x: -24, opacity: 0, duration: 0.5 }, '<');
      const pops = root.querySelectorAll('[data-reveal="pop"]');
      if (pops.length > 0) {
        timeline.from(
          pops,
          { scale: 0.9, opacity: 0, duration: 0.4, stagger: 0.1, ease: 'back.out(1.4)' },
          '<0.1',
        );
      }
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
