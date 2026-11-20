import type { Ref } from 'react';

/** h1 and subtitle of an auth form (Figma Text Field title block). */
export function AuthTitle({
  title,
  subtitle,
  headingRef,
}: {
  title: string;
  subtitle?: string;
  /** For a form that moves focus to its heading on arrival (S7.6). */
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-h4 text-neutral-2 focus:outline-none md:text-h2"
      >
        {title}
      </h1>
      {subtitle ? (
        <p className="mt-3 text-body-4 text-muted-foreground md:text-body-2 xl:text-body-1">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
