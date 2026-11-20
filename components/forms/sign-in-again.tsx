import { Button } from '@/components/ui/button';
import { sessionEndedHref } from '@/lib/auth-links';

/**
 * "Sign in" under "You've been signed out. Sign in again to save your changes." (S2.12). It is a
 * full page load, not a move within the app: this tab still draws the ended session's header and
 * notices, and only a fresh page shows the signed-out state. The form's draft waits in
 * sessionStorage, which a page load keeps.
 */
export function SignInAgain({ returnPath }: { returnPath: string }) {
  return (
    <Button asChild variant="outline" size="touch" className="bg-white">
      <a href={sessionEndedHref(returnPath)}>Sign in</a>
    </Button>
  );
}
