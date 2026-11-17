'use client';

import {
  BriefcaseBusiness,
  Check,
  CircleCheck,
  House,
  MapPin,
  MapPinOff,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { Ref } from 'react';
import type { AddressDto } from '@/server/modules/addresses/schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { isSitePath } from '@/lib/navigation';
import { cn } from '@/lib/utils';

const KIND_ICONS = { HOME: House, WORK: BriefcaseBusiness, OTHER: MapPin } as const;

/** "Delete Work, 1 Faneuil Hall Square?": the label and street, for names and the dialog. */
export const addressName = (address: Pick<AddressDto, 'label' | 'line1'>) =>
  `${address.label}, ${address.line1}`;

/**
 * One saved address (design 5.2): label, Default badge, street and apartment, city, the start of
 * the courier's instructions (as typed, shown as text), and a flag when it is now outside the
 * delivery area (S4.13). The card itself takes focus after a save or a delete.
 */
export function AddressCard({
  address,
  isDefault,
  canEdit,
  ref,
  onSetDefault,
  onDelete,
  busy,
}: {
  address: AddressDto;
  isDefault: boolean;
  canEdit: boolean;
  ref?: Ref<HTMLElement>;
  onSetDefault: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const Icon = KIND_ICONS[address.kind];
  const labelId = `addr-${address.id}-label`;
  const path = `/account/addresses/${address.id}`;
  const editHref: Route = isSitePath(path) ? path : '/account/addresses';

  return (
    <article
      ref={ref}
      id={`addr-${address.id}`}
      tabIndex={-1}
      aria-labelledby={labelId}
      data-address-card=""
      className="flex h-full flex-col rounded-2xl border border-neutral-6 bg-white p-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid md:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-7">
          <Icon className="size-5 text-neutral-2" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id={labelId}
              className="text-body-3 font-semibold text-neutral-1 [overflow-wrap:anywhere]"
            >
              {address.label}
            </h2>
            {isDefault ? (
              <Badge variant="success">
                <Check className="size-3!" aria-hidden />
                Default
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-body-4 text-neutral-2 [overflow-wrap:anywhere]">
            {address.line1}
            {address.line2 ? `, ${address.line2}` : ''}
          </p>
          <p className="text-body-5 text-muted-foreground [overflow-wrap:anywhere]">
            {address.city}
          </p>
          {address.notes ? (
            <p className="mt-2 line-clamp-2 text-body-5 text-neutral-3 [overflow-wrap:anywhere]">
              <span className="sr-only">Instructions for the courier: </span>
              {address.notes}
            </p>
          ) : null}
          {address.deliverable ? null : (
            <p className="mt-3 inline-flex min-h-7 items-center gap-1.5 rounded-md bg-tag-4-bg px-2 text-body-5 text-neutral-1">
              <MapPinOff className="size-3.5 text-destructive" aria-hidden />
              Outside our delivery area now
            </p>
          )}
        </div>
      </div>
      {canEdit ? (
        <div className="mt-auto">
          <div className="mt-4 flex flex-wrap gap-x-1 gap-y-1 border-t border-neutral-6 pt-3">
            <Button
              asChild
              variant="ghost"
              size="touch"
              className="px-3 text-neutral-2 hover:bg-neutral-7"
            >
              <Link href={editHref} aria-label={`Edit ${address.label}`}>
                <Pencil className="size-4" aria-hidden />
                Edit
              </Link>
            </Button>
            {isDefault ? null : (
              <Button
                type="button"
                variant="ghost"
                size="touch"
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (!busy) onSetDefault();
                }}
                className="px-3 text-neutral-2 hover:bg-neutral-7"
              >
                <CircleCheck className="size-4" aria-hidden />
                Set as default
                <span className="sr-only">, {address.label}</span>
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="touch"
              aria-label={`Delete ${address.label}`}
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) onDelete();
              }}
              className={cn('px-3 text-destructive hover:bg-neutral-7 hover:text-destructive')}
            >
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
