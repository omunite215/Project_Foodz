import { prefersReducedMotion } from '@/lib/motion';

/*
 * F8 design 2.8 (amended after review S6): when the problem sheet closes, the deliver screen
 * scrolls its outcome (the waiting clock or the problem notice) into view, smoothly or with a
 * jump under reduced motion. Focus stays on the opener; this only moves the page.
 */

interface Revealable {
  firstElementChild: unknown;
  scrollIntoView: (options: ScrollIntoViewOptions) => void;
}

interface Root {
  querySelector: (selector: string) => Revealable | null;
}

/** Waits for the outcome to render: a frame, then a short retry. */
const TRIES_MS = [0, 150, 400] as const;

const page: Root = {
  querySelector: (selector) => document.querySelector<HTMLElement>(selector),
};

export function revealDeliveryOutcome(
  root: Root = page,
  reduced: boolean = prefersReducedMotion(),
  later: (run: () => void, ms: number) => void = (run, ms) =>
    ms === 0 ? requestAnimationFrame(run) : setTimeout(run, ms),
): void {
  const attempt = (index: number) => {
    const target = root.querySelector('[data-delivery-outcome]');
    if (target?.firstElementChild) {
      target.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
      return;
    }
    const next = TRIES_MS[index + 1];
    if (next !== undefined) later(() => attempt(index + 1), next);
  };
  later(() => attempt(0), 0);
}
