'use client';

import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { PortalContainerContext } from '@/components/ui/portal-container';
import { type PartnerTheme, themeCookie } from '@/lib/partner/text';
import { cn } from '@/lib/utils';

/*
 * The partner app's root (F6 design 0.4, 2.1): the theme the server read from the cookie, so the
 * first paint is right and nothing flashes white at night; the element overlays portal into, so
 * dialogs and sheets keep that theme; and the skip link. Profile › Appearance changes the theme
 * here at once, without a reload, and writes the cookie for the next visit.
 */

interface ThemeValue {
  theme: PartnerTheme;
  /** What "System" means on this phone right now. */
  resolved: 'light' | 'dark';
  setTheme: (theme: PartnerTheme) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeToScheme(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

const systemIsDark = () => window.matchMedia(DARK_QUERY).matches;

export function usePartnerTheme(): ThemeValue {
  return (
    use(ThemeContext) ?? {
      theme: 'system',
      resolved: 'light',
      setTheme: () => {},
    }
  );
}

export function PartnerRoot({
  initialTheme,
  children,
}: {
  initialTheme: PartnerTheme;
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState(initialTheme);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const systemDark = useSyncExternalStore(subscribeToScheme, systemIsDark, () => false);
  const resolved: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  const setTheme = useCallback((next: PartnerTheme) => {
    setThemeState(next);
    // The page's own cookie (design 2.5): read by the next server render.
    document.cookie = themeCookie(next);
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);

  // The installed app's files and offline page (design 2.6). Pages and answers are never kept.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/partner/sw.js', { scope: '/partner' }).catch(() => {
      // Without a worker the app still works online.
    });
  }, []);

  return (
    <ThemeContext value={value}>
      <div
        ref={setRoot}
        data-theme={theme}
        className={cn(
          'partner min-h-dvh bg-neutral-7 text-foreground dark:bg-background',
          theme === 'dark' && 'dark',
        )}
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:inline-flex focus:h-12 focus:items-center focus:rounded-lg focus:bg-strong focus:px-4 focus:text-button-1 focus:font-medium focus:text-background"
        >
          Skip to content
        </a>
        <PortalContainerContext value={root}>{children}</PortalContainerContext>
      </div>
    </ThemeContext>
  );
}
