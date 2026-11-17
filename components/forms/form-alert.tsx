import {
  CircleCheck,
  CircleExclamationPoint,
  Info,
  type LucideIcon,
  TriangleAlert,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';

type Variant = 'error' | 'success' | 'info' | 'warning';

const ICONS: Record<Variant, LucideIcon> = {
  error: CircleExclamationPoint,
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
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
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  variant: Variant;
  children: ReactNode;
  /** A button under the text ("Try again", "Sign in"). */
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  const Icon = icon ?? ICONS[variant];
  return (
    <Alert variant={variant} {...props}>
      <Icon aria-hidden />
      <AlertDescription>
        {children}
        {action ? <div className="mt-3 flex flex-wrap gap-3">{action}</div> : null}
      </AlertDescription>
    </Alert>
  );
}
