import { describe, expect, it, vi } from 'vitest';
import { revealDeliveryOutcome } from './reveal';

const now = (run: () => void) => run();

function page(rendered: boolean[]) {
  const scrollIntoView = vi.fn<(options: ScrollIntoViewOptions) => void>();
  let reads = 0;
  const root = {
    querySelector: (selector: string) => {
      expect(selector).toBe('[data-delivery-outcome]');
      const shown = rendered[Math.min(reads, rendered.length - 1)];
      reads += 1;
      return { firstElementChild: shown ? {} : null, scrollIntoView };
    },
  };
  return { root, scrollIntoView };
}

describe('the problem outcome comes into view (design 2.8, review S6)', () => {
  it('scrolls the outcome to the top, smoothly', () => {
    const { root, scrollIntoView } = page([true]);
    revealDeliveryOutcome(root, false, now);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
  });

  it('jumps under reduced motion', () => {
    const { root, scrollIntoView } = page([true]);
    revealDeliveryOutcome(root, true, now);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
  });

  it('waits for the outcome to render, then gives up quietly', () => {
    const late = page([false, false, true]);
    revealDeliveryOutcome(late.root, false, now);
    expect(late.scrollIntoView).toHaveBeenCalledTimes(1);
    const never = page([false]);
    revealDeliveryOutcome(never.root, false, now);
    expect(never.scrollIntoView).not.toHaveBeenCalled();
  });
});
