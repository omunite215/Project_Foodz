// @vitest-environment jsdom
// React warns about act() outside a test environment unless this is set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScrollMemory } from './scroll-memory';

function Menu() {
  useScrollMemory('/menu');
  return null;
}

/** Mounts the menu (the hook runs in a layout effect) and returns its unmount. */
function mountMenu() {
  const root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Menu)));
  return () => act(() => root.unmount());
}

/** jsdom does not scroll; this tracks window.scrollY and fires scroll events. */
function stubScrolling() {
  let y = 0;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
  const scrollTo = vi.fn<(options: ScrollToOptions) => void>((options) => {
    y = options.top ?? y;
  });
  vi.spyOn(window, 'scrollTo').mockImplementation((options?: ScrollToOptions | number) => {
    if (typeof options === 'object') scrollTo(options);
  });
  return {
    scrollTo,
    scrollBy(dy: number) {
      y += dy;
      window.dispatchEvent(new Event('scroll'));
    },
    set(value: number) {
      y = value;
    },
  };
}

const flushFrames = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/menu?cuisine=thai');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scroll memory', () => {
  it('puts the menu back where it was after Back, when the browser could not', async () => {
    const scroll = stubScrolling();
    const unmountFirst = mountMenu();
    scroll.scrollBy(2700);
    await flushFrames();
    unmountFirst();

    // Off to a dish, then Back: the browser restored into a page that was still too short.
    window.history.pushState(null, '', '/menu/pad-thai');
    window.history.back();
    await vi.waitFor(() => expect(window.location.pathname).toBe('/menu'));
    scroll.set(1570);

    mountMenu();
    expect(scroll.scrollTo).toHaveBeenCalledWith({ top: 2700, behavior: 'instant' });
  });

  it('leaves a position the browser already restored alone', async () => {
    const scroll = stubScrolling();
    const unmountFirst = mountMenu();
    scroll.scrollBy(2700);
    await flushFrames();
    unmountFirst();

    window.history.pushState(null, '', '/menu/pad-thai');
    window.history.back();
    await vi.waitFor(() => expect(window.location.pathname).toBe('/menu'));
    scroll.set(2690);

    mountMenu();
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('does not restore when the menu is opened from a link', async () => {
    const scroll = stubScrolling();
    const unmountFirst = mountMenu();
    scroll.scrollBy(2700);
    await flushFrames();
    unmountFirst();

    // A normal link to the same address starts at the top.
    scroll.set(0);
    mountMenu();
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });
});
