import { Lock } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';

/** Figma Checkout's card: white, 16 px corners, a hairline border (design 0). */
export function SettingsCard({
  title,
  description,
  id,
  headingRef,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  id?: string;
  /** For moving focus to the card (its heading takes focus). */
  headingRef?: Ref<HTMLHeadingElement>;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn('rounded-2xl border border-neutral-6 bg-white p-5 md:p-6', className)}
    >
      <h2
        id={id ? `${id}-title` : undefined}
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="font-heading text-title-2 text-neutral-2 focus:outline-none"
      >
        {title}
      </h2>
      {description ? <p className="mt-1 text-body-5 text-muted-foreground">{description}</p> : null}
      {children ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}

/** h1 of an account page, with an optional line under it. */
export function AccountPageHead({
  title,
  subtitle,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <h1
        tabIndex={-1}
        className="font-heading text-h4 leading-tight text-neutral-2 focus:outline-none md:text-h3"
      >
        {title}
      </h1>
      {subtitle ? <p className="mt-2 text-body-4 text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}

/** A blocked action, replaced by its reason (design 4.6). */
export function LockedLine({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p id={id} className={cn('flex items-start gap-2 text-body-5 text-neutral-3', className)}>
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
