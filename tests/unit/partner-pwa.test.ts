import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

/*
 * The installable partner app (F6 design 2.6, security S9): the start page must sit inside the
 * manifest's scope, or browsers drop the scope and open the whole site in the app; and the worker
 * must be allowed to control that scope, start page included.
 */

const root = path.join(import.meta.dirname, '..', '..');
const manifest: {
  start_url: string;
  scope: string;
  icons: { src: string; purpose: string }[];
} = JSON.parse(readFileSync(path.join(root, 'public/partner/manifest.webmanifest'), 'utf8'));

describe('the partner app manifest and worker', () => {
  it('keeps the start page inside the scope', () => {
    expect(manifest.scope).toBe('/partner');
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
  });

  it('points at icons that exist, one of them maskable', () => {
    for (const icon of manifest.icons) {
      expect(existsSync(path.join(root, 'public', icon.src))).toBe(true);
    }
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('lets the worker under /partner/ control /partner itself', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const worker = rules.find((rule) => rule.source === '/partner/sw.js');
    expect(worker?.headers).toContainEqual({ key: 'Service-Worker-Allowed', value: '/partner' });
  });
});
