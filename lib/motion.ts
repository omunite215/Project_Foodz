import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import type { RefObject } from 'react';

gsap.registerPlugin(useGSAP);

export const MOTION_QUERIES = {
  full: '(prefers-reduced-motion: no-preference)',
  reduced: '(prefers-reduced-motion: reduce)',
} as const;

/** Tween properties that move, scale, rotate or skew an element. */
const MOVEMENT = new Set([
  'x',
  'y',
  'z',
  'xPercent',
  'yPercent',
  'scale',
  'scaleX',
  'scaleY',
  'scaleZ',
  'rotation',
  'rotate',
  'rotationX',
  'rotationY',
  'rotationZ',
  'rotateX',
  'rotateY',
  'rotateZ',
  'skew',
  'skewX',
  'skewY',
  'transform',
  'translate',
  'translateX',
  'translateY',
  'translateZ',
  'motionPath',
]);

/** Keeps fades, colors, timing and callbacks; drops everything that moves. */
export function withoutMovement(vars: gsap.TweenVars): gsap.TweenVars {
  return Object.fromEntries(Object.entries(vars).filter(([key]) => !MOVEMENT.has(key)));
}

export interface Motion {
  /** The user asked for less motion: tweens still fade, but nothing moves. */
  reduced: boolean;
  from(targets: gsap.TweenTarget, vars: gsap.TweenVars): gsap.core.Tween;
  to(targets: gsap.TweenTarget, vars: gsap.TweenVars): gsap.core.Tween;
  fromTo(
    targets: gsap.TweenTarget,
    fromVars: gsap.TweenVars,
    toVars: gsap.TweenVars,
  ): gsap.core.Tween;
}

/**
 * Runs `animate` for the user's motion preference, and again if the preference changes while
 * the page is open (GSAP reverts whatever the previous run created). Under
 * `prefers-reduced-motion: reduce`, every tween made through the `Motion` helpers loses its
 * movement and keeps its fade. Code that builds timelines or scroll effects itself should
 * check `motion.reduced`.
 */
export function createMotion(
  animate: (motion: Motion) => void,
  scope?: Element | string,
): gsap.MatchMedia {
  const media = gsap.matchMedia(scope);
  media.add(MOTION_QUERIES, (context) => {
    const reduced = Boolean(context.conditions?.reduced);
    const adjust = (vars: gsap.TweenVars) => (reduced ? withoutMovement(vars) : vars);
    animate({
      reduced,
      from: (targets, vars) => gsap.from(targets, adjust(vars)),
      to: (targets, vars) => gsap.to(targets, adjust(vars)),
      fromTo: (targets, fromVars, toVars) => gsap.fromTo(targets, adjust(fromVars), adjust(toVars)),
    });
  });
  return media;
}

/**
 * `createMotion` for a component: selector text in `animate` is scoped to `scope`, and every
 * animation is reverted when the component unmounts or a dependency changes.
 */
export function useMotion(
  animate: (motion: Motion) => void,
  { scope, dependencies = [] }: { scope: RefObject<Element | null>; dependencies?: unknown[] },
) {
  useGSAP(
    () => {
      const media = createMotion(animate, scope.current ?? undefined);
      return () => media.revert();
    },
    { scope, dependencies },
  );
}

/** For one-off tweens started by an event (a click, a copy): true when the user asked for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOTION_QUERIES.reduced).matches;
}

/** A small "pop" for something just pressed (a heart): 1.25 back to 1. Nothing under reduced motion. */
export function pop(target: Element | null): void {
  if (!target || prefersReducedMotion()) return;
  gsap.fromTo(target, { scale: 1.25 }, { scale: 1, duration: 0.3, ease: 'back.out(2)' });
}
