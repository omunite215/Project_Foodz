// @vitest-environment jsdom
import { gsap } from 'gsap';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMotion, type Motion, withoutMovement } from './motion';

type Preference = 'reduce' | 'no-preference';

/** jsdom has no matchMedia; this one answers prefers-reduced-motion and can change it live. */
function stubMotionPreference(initial: Preference) {
  let preference = initial;
  const lists: Array<{
    list: MediaQueryList;
    listeners: Set<(event: MediaQueryListEvent) => void>;
  }> = [];

  window.matchMedia = (media: string) => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const list = {
      media,
      get matches() {
        return media.includes(preference);
      },
      onchange: null,
      addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeListener: (listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
    lists.push({ list, listeners });
    return list;
  };

  return {
    change(next: Preference) {
      preference = next;
      for (const { list, listeners } of lists) {
        for (const listener of listeners) {
          listener({ matches: list.matches, media: list.media } as MediaQueryListEvent);
        }
      }
    },
  };
}

function box() {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

/** Plays a tween straight to its end so the final values can be read. */
const finish = (tween: gsap.core.Tween) => tween.progress(1);

const slideIn = (element: Element) => (motion: Motion) => {
  finish(motion.to(element, { x: 120, rotation: 15, scale: 1.2, opacity: 0.5, duration: 0.4 }));
};

afterEach(() => {
  document.body.replaceChildren();
});

const onComplete = () => {};

describe('withoutMovement', () => {
  it('drops transforms and keeps fades, timing and callbacks', () => {
    expect(
      withoutMovement({
        x: 10,
        yPercent: -50,
        scale: 0.9,
        rotation: 45,
        skewX: 5,
        transform: 'none',
        opacity: 0,
        autoAlpha: 1,
        backgroundColor: '#04b90b',
        duration: 0.3,
        delay: 0.1,
        ease: 'power2.out',
        stagger: 0.05,
        onComplete,
      }),
    ).toEqual({
      opacity: 0,
      autoAlpha: 1,
      backgroundColor: '#04b90b',
      duration: 0.3,
      delay: 0.1,
      ease: 'power2.out',
      stagger: 0.05,
      onComplete,
    });
  });
});

describe('createMotion', () => {
  it('runs the full animation when the user has no preference', () => {
    stubMotionPreference('no-preference');
    const element = box();
    const animate = vi.fn<(motion: Motion) => void>(slideIn(element));

    const media = createMotion(animate);

    expect(animate).toHaveBeenCalledWith(expect.objectContaining({ reduced: false }));
    expect(gsap.getProperty(element, 'x')).toBe(120);
    expect(gsap.getProperty(element, 'rotation')).toBe(15);
    expect(gsap.getProperty(element, 'opacity')).toBe(0.5);
    media.revert();
  });

  it('keeps the fade but drops all movement under prefers-reduced-motion', () => {
    stubMotionPreference('reduce');
    const element = box();
    const animate = vi.fn<(motion: Motion) => void>(slideIn(element));

    const media = createMotion(animate);

    expect(animate).toHaveBeenCalledWith(expect.objectContaining({ reduced: true }));
    expect(gsap.getProperty(element, 'x')).toBe(0);
    expect(gsap.getProperty(element, 'rotation')).toBe(0);
    expect(gsap.getProperty(element, 'scale')).toBe(1);
    expect(gsap.getProperty(element, 'opacity')).toBe(0.5);
    media.revert();
  });

  it('applies the same rule to from() and fromTo()', () => {
    stubMotionPreference('reduce');
    const element = box();

    const media = createMotion((motion) => {
      finish(motion.from(element, { y: 40, opacity: 0, duration: 0.3 }));
      finish(motion.fromTo(element, { xPercent: -100 }, { xPercent: 0, duration: 0.3 }));
    });

    expect(gsap.getProperty(element, 'y')).toBe(0);
    expect(gsap.getProperty(element, 'xPercent')).toBe(0);
    media.revert();
  });

  it('skips an element that is not on the page without a "target not found" warning', () => {
    stubMotionPreference('no-preference');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scope = box();
    const badge = document.createElement('span');
    badge.dataset.cartBadge = '';
    scope.append(badge);

    const media = createMotion((motion) => {
      // A badge that went away with the last item, a ref not drawn yet, an empty list.
      finish(motion.fromTo('[data-missing]', { scale: 1.25 }, { scale: 1, duration: 0.3 }));
      finish(motion.from(null, { opacity: 0, duration: 0.2 }));
      finish(motion.to([], { opacity: 0, duration: 0.2 }));
      // Selector text still finds what is inside the scope.
      finish(motion.fromTo('[data-cart-badge]', { scale: 1.25 }, { scale: 1, duration: 0.3 }));
    }, scope);

    expect(warn).not.toHaveBeenCalled();
    expect(gsap.getProperty(badge, 'scale')).toBe(1);
    media.revert();
    warn.mockRestore();
  });

  it('switches to reduced motion when the preference changes mid-session', async () => {
    const preference = stubMotionPreference('no-preference');
    const element = box();
    const animate = vi.fn<(motion: Motion) => void>(slideIn(element));
    const media = createMotion(animate);
    expect(gsap.getProperty(element, 'x')).toBe(120);

    preference.change('reduce');

    await vi.waitFor(() =>
      expect(animate).toHaveBeenLastCalledWith(expect.objectContaining({ reduced: true })),
    );
    expect(gsap.getProperty(element, 'x')).toBe(0);
    expect(gsap.getProperty(element, 'opacity')).toBe(0.5);
    media.revert();
  });

  it('removes inline styles when reverted', () => {
    stubMotionPreference('no-preference');
    const element = box();

    createMotion(slideIn(element)).revert();

    expect(element.style.transform).toBe('');
    expect(element.style.opacity).toBe('');
  });
});
