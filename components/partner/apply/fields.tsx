'use client';

import {
  Bike,
  Car,
  Check,
  CircleCheck,
  CircleX,
  type LucideIcon,
  Motorbike,
  Scooter,
} from 'lucide-react';
import { type ReactNode, useId, useRef } from 'react';
import type { VehicleType } from '@/server/db/enums';
import { ID_DOCUMENT_TYPES, type IdDocumentType } from '@/server/modules/partners/rules';
import { DOCUMENT_WORDS, VEHICLE_WORDS } from '@/server/modules/partners/text';
import { FieldError } from '@/components/ui/field';
import { useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/*
 * The application's own controls (F6 design 4.5, 4.6, 4.7.2): native radios and checkboxes in
 * the partner app's colours, 48 px targets, the choice shown by border, tint and a tick, never
 * colour alone.
 */

/** Partner text inputs: 48 px, semantic colours for light and dark. */
export const PARTNER_INPUT =
  'h-12 w-full min-w-0 rounded-xl border border-input bg-card px-4 text-body-4 text-strong outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:border-destructive';

export const PARTNER_LABEL = 'block text-body-4 font-medium text-strong';

const VEHICLES: { value: VehicleType; icon: LucideIcon }[] = [
  { value: 'BICYCLE', icon: Bike },
  { value: 'SCOOTER', icon: Scooter },
  { value: 'MOTORBIKE', icon: Motorbike },
  { value: 'CAR', icon: Car },
];

function TileCheck({ checked }: { checked: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useMotion(
    (motion) => {
      if (!checked || !ref.current || motion.reduced) return;
      motion.fromTo(ref.current, { scale: 0.6 }, { scale: 1, duration: 0.15, ease: 'back.out(2)' });
    },
    { scope: ref, dependencies: [checked] },
  );
  return (
    <span
      ref={ref}
      aria-hidden
      className="absolute top-3 right-3 hidden group-has-[:checked]:block"
    >
      <CircleCheck className="size-5 text-success-mark" />
    </span>
  );
}

export function VehicleTiles({
  value,
  error,
  onChange,
}: {
  value: VehicleType | '';
  error: string | null;
  onChange: (value: VehicleType) => void;
}) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    <fieldset aria-describedby={errorId} className="min-w-0">
      <legend className="text-body-4 font-medium text-strong">What will you deliver with?</legend>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {VEHICLES.map((vehicle, index) => {
          const Icon = vehicle.icon;
          return (
            <label
              key={vehicle.value}
              className="group relative flex min-h-28 cursor-pointer flex-col justify-between gap-3 rounded-2xl border border-input bg-card p-4 has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-success-soft has-[:checked]:p-[15px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid"
            >
              <input
                type="radio"
                name="vehicleType"
                value={vehicle.value}
                checked={value === vehicle.value}
                onChange={() => onChange(vehicle.value)}
                data-invalid={error && index === 0 ? 'true' : undefined}
                className="sr-only"
              />
              <Icon className="size-8 text-foreground" aria-hidden />
              <span className="text-body-4 font-medium text-strong">
                {/* "e-bike" never breaks at its hyphen. */}
                {VEHICLE_WORDS[vehicle.value].replace('e-bike', 'e‑bike')}
              </span>
              <TileCheck checked={value === vehicle.value} />
            </label>
          );
        })}
      </div>
      <FieldError id={errorId}>{error}</FieldError>
    </fieldset>
  );
}

/** "Which ID will you use?": bicycles choose (P4.2). */
export function DocumentChoice({
  value,
  error,
  onChange,
}: {
  value: IdDocumentType | '';
  error: string | null;
  onChange: (value: IdDocumentType) => void;
}) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    <fieldset aria-describedby={errorId} className="min-w-0">
      <legend className="text-body-4 font-medium text-strong">Which ID will you use?</legend>
      <div className="mt-3 flex flex-wrap gap-2">
        {ID_DOCUMENT_TYPES.map((type, index) => (
          <label
            key={type}
            className="group relative inline-flex h-12 cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-4 text-body-4 text-strong has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-success-soft has-[:checked]:px-[15px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid"
          >
            <input
              type="radio"
              name="idDocumentType"
              value={type}
              checked={value === type}
              onChange={() => onChange(type)}
              data-invalid={error && index === 0 ? 'true' : undefined}
              className="sr-only"
            />
            {DOCUMENT_WORDS[type]}
            <Check
              className="hidden size-4 text-success-mark group-has-[:checked]:block"
              aria-hidden
            />
          </label>
        ))}
      </div>
      <FieldError id={errorId}>{error}</FieldError>
    </fieldset>
  );
}

/** A native checkbox in a 48 px row (design 4.7.2). */
export function PartnerCheckbox({
  id,
  checked,
  error,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  error: string | null;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div>
      <label
        htmlFor={id}
        className="flex min-h-12 cursor-pointer items-center gap-3 text-body-4 text-strong"
      >
        <span className="relative flex size-6 shrink-0">
          <input
            id={id}
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className="peer size-6 shrink-0 cursor-pointer appearance-none rounded-md border-2 border-input bg-card checked:border-primary checked:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:border-destructive"
          />
          <Check
            className="pointer-events-none absolute inset-1 hidden size-4 text-primary-foreground peer-checked:block"
            strokeWidth={3}
            aria-hidden
          />
        </span>
        <span className="min-w-0">{children}</span>
      </label>
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

/** A flat card in `currentColor`: face square, four text lines, all four corners in frame. */
function CardDrawing({ good }: { good: boolean }) {
  return (
    <svg viewBox="0 0 160 101" aria-hidden className="w-full text-foreground">
      <g
        transform={good ? undefined : 'rotate(12 80 50) translate(18 -6)'}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      >
        <rect x="8" y="8" width="144" height="85" rx="8" />
        <rect x="20" y="22" width="34" height="42" rx="4" />
        <g opacity={good ? 1 : 0.45} strokeWidth={good ? 3 : 6}>
          <path d="M66 28h66M66 42h52M66 56h60M20 78h80" />
        </g>
      </g>
      {good ? null : (
        <ellipse cx="108" cy="36" rx="22" ry="12" fill="currentColor" opacity="0.18" />
      )}
    </svg>
  );
}

/** The two drawn examples above the ID photo (P4.5, moodboard §4.8): never a real ID. */
export function IdExamples() {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      <figure className="rounded-xl border border-border bg-card p-3">
        <CardDrawing good />
        <figcaption className="mt-2 flex gap-1.5 text-body-5 text-strong">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-mark" aria-hidden />
          Flat, all four corners, easy to read
        </figcaption>
      </figure>
      <figure className="overflow-hidden rounded-xl border border-border bg-card p-3">
        <CardDrawing good={false} />
        <figcaption className="mt-2 flex gap-1.5 text-body-5 text-strong">
          <CircleX className="mt-0.5 size-4 shrink-0 text-danger-mark" aria-hidden />
          Blurry, glare or cut off
        </figcaption>
      </figure>
    </div>
  );
}

/** A text field in partner colours: label, control, hint, error, tied together. */
export function PartnerField({
  id,
  label,
  hint,
  error,
  above,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error: string | null;
  /** A line above the control (the ID number's safety note). */
  above?: ReactNode;
  children: (control: {
    id: string;
    'aria-invalid'?: true;
    'aria-describedby'?: string;
  }) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className={PARTNER_LABEL}>
        {label}
      </label>
      {above}
      <div className="mt-2">
        {children({
          id,
          ...(error ? { 'aria-invalid': true as const } : {}),
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        })}
      </div>
      {hint ? (
        <div id={hintId} className="mt-2 space-y-1 text-body-5 text-muted-foreground">
          {hint}
        </div>
      ) : null}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

export const cnInput = (...extra: (string | false | undefined)[]) => cn(PARTNER_INPUT, ...extra);
