import {
  CircleCheck,
  CircleExclamationPoint,
  Info,
  type LucideIcon,
  TriangleAlert,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

type Variant = 'error' | 'success' | 'info' | 'warning';

const ICONS: Record<Variant, LucideIcon> = {
  error: CircleExclamationPoint,
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
};

/**
 * The partner app's colours (F6 design 0.3): soft fills and marks that work in light and dark,
 * with text in `strong`.
 */
const PARTNER_TONES: Record<Variant, string> = {
  error: 'bg-danger-soft text-strong [&>svg]:text-danger-mark',
  success: 'bg-success-soft text-strong [&>svg]:text-success-mark',
  info: 'bg-muted text-strong [&>svg]:text-muted-foreground',
  warning: 'bg-warning-soft text-strong [&>svg]:text-warning-mark',
};

/**
 * One message for a whole form, at its top (design 2.4). Its words are announced once by the
 * caller through `announce()`; the box itself is not a live region.
 */
export function FormAlert({
  variant,
  children,
  action,
  icon,
  tone,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  variant: Variant;
  /** The partner app's light-and-dark colours. */
  tone?: 'partner';
  children: ReactNode;
  /** A button under the text ("Try again", "Sign in"). */
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  const Icon = icon ?? ICONS[variant];
  return (
    <Alert
      variant={variant}
      className={cn(tone === 'partner' && PARTNER_TONES[variant], className)}
      {...props}
    >
      <Icon aria-hidden />
      <AlertDescription>
        {children}
        {action ? <div className="mt-3 flex flex-wrap gap-3">{action}</div> : null}
      </AlertDescription>
    </Alert>
  );
}
