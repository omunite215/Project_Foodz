import { cn } from '@/lib/utils';

/*
 * The success check, still (F4 design 3.3, D33): the last frame of the check animation in
 * public/lottie/check-mark-success.json, drawn with the same geometry, so the still and the end of
 * the animation are identical. Used on reloads, under reduced motion, without scripts and when
 * the animation can't load. Always decorative: the heading carries the meaning.
 */

export function SuccessCheck({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 96 96"
      aria-hidden
      focusable="false"
      className={cn('size-24', className)}
      data-success-check
    >
      <circle cx="48" cy="48" r="40" className="fill-brand-soft" />
      <circle cx="48" cy="48" r="40" fill="none" strokeWidth="6" className="stroke-brand-strong" />
      <path
        d="M30 49 L43 62 L67 37"
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-brand-strong"
      />
    </svg>
  );
}
