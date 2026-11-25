import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * F8 (design 2.12, A51.3, open item 7): F7's interim deliver screen and its delivered notice
 * are gone. No component, route or string from them remains.
 */

const ROOTS = ['components', 'app', 'lib'];
const GONE = [
  'Foodz support will mark it delivered.',
  "You're waiting for orders again.",
  'InterimDeliver',
  'DeliveryDock',
  'OpenInMapsLink',
];

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("F7's interim deliver screen", () => {
  it('leaves nothing behind', () => {
    const found = ROOTS.flatMap(filesUnder).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return GONE.filter((needle) => text.includes(needle)).map((needle) => `${file}: ${needle}`);
    });
    expect(found).toEqual([]);
  });
});
