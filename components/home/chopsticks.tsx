import { cn } from '@/lib/utils';

/** Two chopsticks on a rest, drawn from the simple shapes in the design. Decorative. */
export function Chopsticks({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 392 422"
      fill="none"
      aria-hidden
      focusable="false"
      className={cn('pointer-events-none', className)}
    >
      <rect
        x="30"
        y="376"
        width="150"
        height="26"
        rx="13"
        transform="rotate(-8 105 389)"
        className="fill-chopstick-rest"
      />
      <rect
        x="-16"
        y="190"
        width="420"
        height="14"
        rx="7"
        transform="rotate(-58 194 197)"
        className="fill-neutral-2"
      />
      <rect
        x="16"
        y="214"
        width="420"
        height="14"
        rx="7"
        transform="rotate(-50 226 221)"
        className="fill-neutral-2"
      />
    </svg>
  );
}
