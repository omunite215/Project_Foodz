/** The first stop for keyboard users: jumps past the header to the page content. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:inline-flex focus:h-11 focus:items-center focus:rounded-lg focus:bg-neutral-1 focus:px-4 focus:text-button-1 focus:font-medium focus:text-neutral-8"
    >
      Skip to main content
    </a>
  );
}
