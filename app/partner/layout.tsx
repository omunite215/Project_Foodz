import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { PartnerRoot } from '@/components/partner/partner-root';
import { THEME_COLORS, THEME_COOKIE, themeOf } from '@/lib/partner/text';

export const metadata: Metadata = {
  title: { absolute: 'Foodz Partner', template: '%s | Foodz Partner' },
  // B15: never indexed; `no-store` is a response header for /partner (next.config).
  robots: { index: false, follow: false },
  manifest: '/partner/manifest.webmanifest',
  icons: { apple: '/partner/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Foodz Partner', statusBarStyle: 'default' },
};

/** The status bar matches the plain header in the chosen theme (design 2.5). */
export async function generateViewport(): Promise<Viewport> {
  const theme = themeOf((await cookies()).get(THEME_COOKIE)?.value);
  const colors = THEME_COLORS.plain;
  return {
    themeColor:
      theme === 'system'
        ? [
            { media: '(prefers-color-scheme: light)', color: colors.light },
            { media: '(prefers-color-scheme: dark)', color: colors.dark },
          ]
        : colors[theme],
    viewportFit: 'cover',
  };
}

/**
 * Every `/partner` page (F6 design 2.1): the partner app's own frame, without the storefront's
 * header, footer or cart (P8.1). The theme comes from the cookie in this render, so the first
 * paint is right in the dark (P13.1).
 */
export default async function PartnerLayout({ children }: { children: ReactNode }) {
  const theme = themeOf((await cookies()).get(THEME_COOKIE)?.value);
  return <PartnerRoot initialTheme={theme}>{children}</PartnerRoot>;
}
