import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/*
 * Open Doodles (CC0, design "Illustrations"), in the partner app's two inks: each doodle is two
 * masks, its line work and its accent, filled with `--doodle-ink` and `--doodle-accent`, so one
 * file serves light and dark without a second download and dark mode gets no white shapes
 * (P13.2). Decorative: hidden from screen readers. Static: nothing floats or loops.
 */

export type DoodleName = 'coffee' | 'meditating' | 'sprinting' | 'strolling';

const layer = (name: DoodleName, part: 'ink' | 'accent'): CSSProperties => {
  const url = `url(/illustrations/doodles/${name}-${part}.svg)`;
  return {
    maskImage: url,
    WebkitMaskImage: url,
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
  };
};

export function Doodle({ name, className }: { name: DoodleName; className?: string }) {
  return (
    <span aria-hidden className={cn('relative mx-auto block aspect-[4/3]', className)}>
      <span className="absolute inset-0 bg-[var(--doodle-accent)]" style={layer(name, 'accent')} />
      <span className="absolute inset-0 bg-[var(--doodle-ink)]" style={layer(name, 'ink')} />
    </span>
  );
}
