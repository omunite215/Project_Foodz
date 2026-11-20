'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { useDebouncer } from '@tanstack/react-pacer';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BriefcaseBusiness,
  House,
  Info,
  MapPin,
  MapPinOff,
  RotateCcw,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ComponentType, useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { z } from 'zod';
import {
  checkDeliveryAreaAction,
  createAddressAction,
  updateAddressAction,
} from '@/server/modules/addresses/actions';
import {
  ADDRESS_KINDS,
  type AddressDto,
  type AddressKind,
  type AddressSuggestion,
  type StoreArea,
} from '@/server/modules/addresses/schema';
import { LockedLine } from '@/components/account/settings-card';
import { CheckboxRow, type Choice, ChoiceChips } from '@/components/forms/choice-chips';
import { blurField, FieldShell, visibleError } from '@/components/forms/field-shell';
import { FormAlert } from '@/components/forms/form-alert';
import { SignInAgain } from '@/components/forms/sign-in-again';
import { focusFirstInvalid, focusThenAnnounce, submitChecked } from '@/components/forms/feedback';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { type ActionFailure, callAction, fieldError } from '@/lib/action-result';
import { deliveryText } from '@/lib/account-text';
import { announce } from '@/lib/announce';
import { forgetDraft, saveDraft, takeDraft, useUnsavedChanges } from '@/lib/form-draft';
import {
  distanceMeters,
  FAR_FROM_ADDRESS_M,
  movePoint,
  offsetText,
  type Point,
  roughMeters,
} from '@/lib/map-geometry';
import { cn } from '@/lib/utils';
import { AddressCombobox } from './address-combobox';
import type { AddressMapProps } from './address-map';
import { setAddressStatus } from './address-status';
import {
  CHECK_FAILED_TEXT,
  DELIVERY_RESULT_ID,
  DeliveryResult,
  type DeliveryState,
} from './delivery-result';

const KINDS: readonly Choice<AddressKind>[] = [
  { value: 'HOME', label: 'Home', icon: House },
  { value: 'WORK', label: 'Work', icon: BriefcaseBusiness },
  { value: 'OTHER', label: 'Other', icon: MapPin },
];

const NOTES_MAX = 200;
const LABEL_MAX = 30;
const NEEDS_CHECK = 'We need to check delivery before saving.';
const SESSION_ENDED = "You've been signed out. Sign in again to save your changes.";
const DRAFT_RESTORED = 'We kept your changes. Press Save to keep them.';

const fields = z
  .object({
    query: z.string(),
    houseNumber: z.string().trim().max(12, 'Use 12 characters or fewer.'),
    line2: z.string().trim().max(100, 'Use 100 characters or fewer.'),
    notes: z.string().trim().max(NOTES_MAX, 'Use 200 characters or fewer.'),
    kind: z.enum(ADDRESS_KINDS),
    label: z.string().trim().max(LABEL_MAX, 'Use 30 characters or fewer.'),
    isDefault: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'OTHER' && !value.label.trim()) {
      ctx.addIssue({ code: 'custom', path: ['label'], message: 'Give this place a name.' });
    }
  });

type Values = z.input<typeof fields>;

/** Where the search put the address. */
interface Found {
  line1: string;
  city: string;
  hasHouseNumber: boolean;
  point: Point;
}

const draftSchema = z.object({
  values: z.object({
    query: z.string().max(200),
    houseNumber: z.string().max(12),
    line2: z.string().max(100),
    notes: z.string().max(NOTES_MAX),
    kind: z.enum(ADDRESS_KINDS),
    label: z.string().max(LABEL_MAX),
    isDefault: z.boolean(),
  }),
  found: z
    .object({
      line1: z.string().max(200),
      city: z.string().max(120),
      hasHouseNumber: z.boolean(),
      point: z.object({ lat: z.number(), lng: z.number() }),
    })
    .nullable(),
  pin: z.object({ lat: z.number(), lng: z.number() }).nullable(),
});

type MapState = 'idle' | 'loading' | 'ready' | 'failed';

/** Counter under a text field; announced once near and at the limit. */
function useLimitAnnouncer(length: number, max: number) {
  const said = useRef<{ near: boolean; full: boolean }>({ near: false, full: false });
  useEffect(() => {
    if (length >= max && !said.current.full) {
      said.current.full = true;
      announce('No characters left');
    } else if (length >= max - 20 && length < max && !said.current.near) {
      said.current.near = true;
      announce(`${max - length} characters left`);
    }
    if (length < max - 20) said.current = { near: false, full: false };
    else if (length < max) said.current.full = false;
  }, [length, max]);
}

export interface AddressFormProps {
  /** Editing this address; null for a new one. */
  address: AddressDto | null;
  store: StoreArea;
  /** Preselected "Save as" for a new address. */
  defaultKind: AddressKind;
  /** No address saved yet: this one becomes the default by itself. */
  firstAddress: boolean;
  /** False for the shared demo accounts (U2): everything works except saving. */
  canSave: boolean;
  /**
   * The signed-in account. If the session ends before Save, what was typed is kept for this
   * account only and comes back after it signs in again (S2.12).
   */
  draftOwner: string;
}

/**
 * Add or edit an address (S4.2 to S4.10, design 5.4). One column at every width, so checkout can
 * reuse it. The delivery check runs on the server for the picked point (or the moved pin); Save is
 * blocked, with the reason beside it, until that check says we deliver there.
 */
export function AddressForm({
  address,
  store,
  defaultKind,
  firstAddress,
  canSave,
  draftOwner,
}: AddressFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const id = useId();
  const ids = {
    address: `${id}-address`,
    houseNumber: `${id}-house-number`,
    line2: `${id}-line2`,
    notes: `${id}-notes`,
    label: `${id}-label`,
    isDefault: `${id}-default`,
    defaultHint: `${id}-default-hint`,
    needsCheck: `${id}-needs-check`,
    locked: `${id}-locked`,
  };

  const savedPoint = address ? { lat: address.lat, lng: address.lng } : null;
  const [found, setFound] = useState<Found | null>(
    address && savedPoint
      ? { line1: address.line1, city: address.city, hasHouseNumber: true, point: savedPoint }
      : null,
  );
  const [pin, setPin] = useState<Point | null>(savedPoint);
  const [pinMoved, setPinMoved] = useState(false);
  const [recentre, setRecentre] = useState(0);
  const [delivery, setDelivery] = useState<DeliveryState>(
    address
      ? {
          kind: address.deliverable ? 'inside' : 'outside',
          text: deliveryText(
            {
              deliverable: address.deliverable,
              distanceKm: address.distanceKm,
              radiusKm: store.radiusKm,
              storeStreet: store.street,
            },
            address.line1,
          ),
        }
      : { kind: 'idle' },
  );
  const [mapState, setMapState] = useState<MapState>(address ? 'loading' : 'idle');
  const [MapView, setMapView] = useState<ComponentType<AddressMapProps> | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [houseError, setHouseError] = useState<string | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const checkRef = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);

  const editingDefault = Boolean(address?.isDefault);
  const defaultLocked = firstAddress || editingDefault;

  const form = useForm({
    defaultValues: {
      query: address?.line1 ?? '',
      houseNumber: '',
      line2: address?.line2 ?? '',
      notes: address?.notes ?? '',
      kind: address?.kind ?? defaultKind,
      label: address?.kind === 'OTHER' ? address.label : '',
      isDefault: defaultLocked,
    } satisfies Values,
    validationLogic: revalidateLogic({ mode: 'blur', modeAfterSubmission: 'change' }),
    validators: { onDynamic: fields },
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: ({ value }) => save(value),
  }); // Re-render the fields when a submit is tried, so every error shows.
  const submitted = useStore(form.store, (formState) => formState.submissionAttempts > 0);
  const valuesUnchanged = useStore(form.store, (formState) => formState.isDefaultValue);
  // The pick and the pin as the form opened: moving either is a change too.
  const [opened] = useState(() => ({ found, pin }));
  useUnsavedChanges(canSave && (!valuesUnchanged || found !== opened.found || pin !== opened.pin));

  // Load the map the first time there is a point to show (S7.9: never before).
  useEffect(() => {
    if (!pin || MapView || mapState === 'failed') return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await import('./address-map');
        if (!cancelled) setMapView(() => loaded.default);
      } catch {
        if (!cancelled) setMapState('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pin, MapView, mapState]);

  async function runCheck(point: Point, place: string, prefix?: string) {
    const request = ++checkRef.current;
    setDelivery({ kind: 'checking', check: request });
    const outcome = await callAction(() =>
      checkDeliveryAreaAction({ lat: point.lat, lng: point.lng, line1: place.slice(0, 200) }),
    );
    if (request !== checkRef.current) return;
    if (!outcome.ok) {
      setDelivery({ kind: 'failed' });
      announce(prefix ? `${prefix} ${CHECK_FAILED_TEXT}` : CHECK_FAILED_TEXT);
      return;
    }
    const text = deliveryText(outcome.data, place);
    setDelivery({ kind: outcome.data.deliverable ? 'inside' : 'outside', text });
    announce(prefix ? `${prefix} ${text}` : text);
  }

  // Back from signing in after the session ended (S2.12): what was typed comes back, for the
  // same person only.
  const restoreDraft = useEffectEvent(() => {
    if (!canSave) return;
    const draft = takeDraft(pathname, draftOwner, draftSchema);
    if (!draft) return;
    form.reset(draft.values, { keepDefaultValues: true });
    setFound(draft.found);
    setPin(draft.pin);
    if (draft.found && draft.pin) {
      setMapState('loading');
      setPinMoved(distanceMeters(draft.found.point, draft.pin) > 1);
      void runCheck(draft.pin, draft.found.line1);
    }
    announce(DRAFT_RESTORED);
  });
  useEffect(() => {
    const timer = setTimeout(restoreDraft, 0);
    return () => clearTimeout(timer);
  }, []);

  const pinCheck = useDebouncer(
    (point: Point, how: 'tap' | 'move') => {
      const offset = found && how === 'move' ? offsetText(found.point, point) : null;
      const prefix =
        how === 'tap'
          ? 'Pin placed.'
          : offset
            ? `Pin moved ${offset} from the address.`
            : 'Pin moved.';
      void runCheck(point, 'this spot', prefix);
    },
    { wait: 600 },
  );

  function movePin(point: Point, how: 'tap' | 'move') {
    if (!found) return;
    setPin(point);
    setPinMoved(distanceMeters(found.point, point) > 1);
    setHouseError(null);
    pinCheck.maybeExecute(point, how);
  }

  function pick(item: AddressSuggestion) {
    pinCheck.cancel();
    const point = { lat: item.lat, lng: item.lng };
    form.setFieldValue('query', item.line1);
    form.setFieldValue('houseNumber', '', { dontUpdateMeta: true });
    setFound({ line1: item.line1, city: item.city, hasHouseNumber: item.hasHouseNumber, point });
    setPin(point);
    setPinMoved(false);
    setAddressError(null);
    setHouseError(null);
    setFailure(null);
    if (mapState !== 'failed') setMapState(mapState === 'ready' ? 'ready' : 'loading');
    setRecentre((count) => count + 1);
    void runCheck(point, item.line1);
  }

  function clearPick(text: string) {
    form.setFieldValue('query', text);
    if (found) {
      // Typing after a pick: the result resets; the pin keeps its place until a new pick.
      checkRef.current++;
      pinCheck.cancel();
      setFound(null);
      setDelivery({ kind: 'idle' });
    }
    setAddressError(null);
  }

  const verdict = delivery.kind;
  const deliverable = verdict === 'inside';
  const blockedReason: 'outside' | 'check' | null = !found
    ? null
    : verdict === 'outside'
      ? 'outside'
      : verdict === 'inside'
        ? null
        : 'check';

  async function save(value: Values) {
    if (busyRef.current || !canSave) return;
    if (!found || !pin) {
      const text = 'Pick an address from the suggestions.';
      setAddressError(text);
      focusThenAnnounce(ids.address);
      return;
    }
    const houseNumber = value.houseNumber.trim();
    if (!found.hasHouseNumber && !houseNumber && !pinMoved) {
      setHouseError('Add your house number, or move the pin to your door.');
      focusThenAnnounce(ids.houseNumber);
      return;
    }
    if (!deliverable) {
      announce(delivery.kind === 'outside' ? delivery.text : NEEDS_CHECK);
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    const payload = {
      kind: value.kind,
      ...(value.kind === 'OTHER' ? { label: value.label.trim() } : {}),
      line1: !found.hasHouseNumber && houseNumber ? `${houseNumber} ${found.line1}` : found.line1,
      line2: value.line2.trim() || undefined,
      city: found.city,
      notes: value.notes.trim() || undefined,
      lat: pin.lat,
      lng: pin.lng,
      isDefault: value.isDefault,
    };
    const outcome = await callAction(() =>
      address ? updateAddressAction({ id: address.id, ...payload }) : createAddressAction(payload),
    );
    busyRef.current = false;
    setBusy(false);

    if (outcome.ok) {
      forgetDraft(pathname);
      setAddressStatus({ text: 'Address saved', focusId: outcome.data.id });
      router.push('/account/addresses');
      return;
    }
    const error = outcome.error;
    switch (error.code) {
      case 'OUTSIDE_DELIVERY_AREA': {
        const distanceKm = Number(error.details?.distanceKm);
        const radiusKm = Number(error.details?.radiusKm ?? store.radiusKm);
        const place = pinMoved ? 'this spot' : payload.line1;
        const text = Number.isFinite(distanceKm)
          ? deliveryText(
              { deliverable: false, distanceKm, radiusKm, storeStreet: store.street },
              place,
            )
          : error.message;
        setDelivery({ kind: 'outside', text });
        announce(text);
        return;
      }
      case 'UNAUTHENTICATED':
        saveDraft(pathname, draftOwner, { values: value, found, pin });
        setFailure(error);
        focusThenAnnounce(null, SESSION_ENDED);
        return;
      case 'INVALID_INPUT': {
        setFailure(error);
        const where = fieldError(error, 'line1') || fieldError(error, 'city');
        if (where) setAddressError(where);
        const first = where
          ? ids.address
          : fieldError(error, 'line2')
            ? ids.line2
            : fieldError(error, 'notes')
              ? ids.notes
              : ids.label;
        focusThenAnnounce(first);
        return;
      }
      default:
        setFailure(error);
        focusThenAnnounce(null, error.message);
    }
  }

  const farFromAddress = found && pin && pinMoved ? distanceMeters(found.point, pin) : 0;

  return (
    <form
      ref={formRef}
      noValidate
      method="post"
      aria-label={address ? `Edit ${address.label}` : 'Add an address'}
      className="max-w-[640px]"
      onSubmit={(event) => {
        event.preventDefault();
        void submitChecked(form);
      }}
    >
      {failure && failure.code !== 'INVALID_INPUT' ? (
        <FormAlert
          variant={failure.code === 'UNAUTHENTICATED' ? 'info' : 'error'}
          className="mb-6"
          action={failure.code === 'UNAUTHENTICATED' ? <SignInAgain returnPath={pathname} /> : null}
        >
          {failure.code === 'UNAUTHENTICATED' ? SESSION_ENDED : failure.message}
        </FormAlert>
      ) : null}

      <div className="space-y-6">
        <form.Field name="query">
          {(field) => (
            <FieldShell
              id={ids.address}
              label="Address"
              hint="Start typing your street address."
              error={addressError}
            >
              {(control) => (
                <AddressCombobox
                  control={control}
                  value={field.state.value}
                  onType={clearPick}
                  onPick={pick}
                />
              )}
            </FieldShell>
          )}
        </form.Field>

        {found && !found.hasHouseNumber ? (
          <form.Field name="houseNumber">
            {(field) => (
              <FieldShell
                id={ids.houseNumber}
                label="House number"
                hint="Or move the pin to your door."
                error={houseError ?? visibleError(field.state.meta, submitted)}
              >
                {(control) => (
                  <Input
                    {...control}
                    name="houseNumber"
                    autoComplete="off"
                    inputMode="text"
                    maxLength={12}
                    className="max-w-[10rem]"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      setHouseError(null);
                    }}
                    onBlur={blurField(field.handleBlur)}
                  />
                )}
              </FieldShell>
            )}
          </form.Field>
        ) : null}

        <div>
          {/* No pin to move while the map is down. */}
          {mapState === 'failed' ? null : (
            <p className="mb-2 text-body-5 text-neutral-3">
              Not exactly right? Move the pin to your door.
            </p>
          )}
          <div className="relative aspect-[16/10] w-full rounded-2xl bg-neutral-7">
            {mapState === 'failed' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                <MapPinOff className="size-6 text-neutral-3" aria-hidden />
                <p className="text-body-4 font-medium text-neutral-2">Map unavailable right now</p>
                <p className="text-body-5 text-neutral-3">We&apos;ll use the address as found.</p>
              </div>
            ) : !pin ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                <MapPin className="size-6 text-neutral-4" aria-hidden />
                <p className="text-body-5 text-neutral-3">
                  Pick an address and we&apos;ll show it here.
                </p>
              </div>
            ) : (
              <>
                {MapView ? (
                  <div
                    className={cn(
                      'absolute inset-0 transition-opacity duration-200',
                      mapState === 'ready' ? 'opacity-100' : 'opacity-0',
                    )}
                  >
                    <MapView
                      pin={pin}
                      place={found?.line1 ?? 'your address'}
                      recentre={recentre}
                      onPinMove={(point, how) => movePin(point, how === 'tap' ? 'tap' : 'move')}
                      onKeyMove={(direction, meters) =>
                        movePin(movePoint(pin, direction, meters), 'move')
                      }
                      onReady={() => setMapState('ready')}
                      onFailed={() => setMapState('failed')}
                    />
                  </div>
                ) : null}
                {mapState !== 'ready' ? (
                  <div
                    aria-busy="true"
                    className="absolute inset-0 animate-skeleton rounded-2xl bg-neutral-7 motion-reduce:animate-none"
                  >
                    <span className="sr-only">Loading map</span>
                  </div>
                ) : null}
              </>
            )}
          </div>
          <fieldset
            className={cn(
              'mt-3 flex min-w-0 flex-wrap items-center gap-2',
              mapState !== 'ready' && 'invisible',
            )}
          >
            <legend className="sr-only">Move the pin</legend>
            {(
              [
                ['up', ArrowUp],
                ['down', ArrowDown],
                ['left', ArrowLeft],
                ['right', ArrowRight],
              ] as const
            ).map(([direction, Icon]) => (
              <Button
                key={direction}
                type="button"
                variant="outline"
                size="icon-touch"
                className="rounded-xl border-neutral-6 bg-white text-neutral-2 hover:bg-neutral-7"
                onClick={() => pin && movePin(movePoint(pin, direction, 10), 'move')}
              >
                <Icon className="size-5" aria-hidden />
                <span className="sr-only">Move pin {direction}</span>
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="touch"
              aria-disabled={!pinMoved || undefined}
              onClick={() => {
                if (!pinMoved || !found) return;
                pinCheck.cancel();
                setPin(found.point);
                setPinMoved(false);
                setRecentre((count) => count + 1);
                void runCheck(found.point, found.line1, 'Pin back on the address.');
              }}
              className="ml-auto text-neutral-2 hover:bg-neutral-7 aria-disabled:cursor-not-allowed aria-disabled:text-neutral-4"
            >
              <RotateCcw className="size-4" aria-hidden />
              Reset pin
            </Button>
          </fieldset>
          {farFromAddress > FAR_FROM_ADDRESS_M && found ? (
            <p className="mt-2 flex items-start gap-1.5 text-body-5 text-neutral-3">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              The pin is {roughMeters(farFromAddress)} from {found.line1}. Check it&apos;s on your
              building.
            </p>
          ) : null}
          {pin && mapState !== 'failed' ? (
            <p className="mt-2 text-caption text-muted-foreground">
              Map ©{' '}
              <a
                href="https://openfreemap.org"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                OpenFreeMap
              </a>{' '}
              · ©{' '}
              <a
                href="https://www.openmaptiles.org"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                OpenMapTiles
              </a>{' '}
              · Data ©{' '}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                OpenStreetMap
              </a>{' '}
              contributors
            </p>
          ) : null}
        </div>

        <DeliveryResult
          state={delivery}
          onRetry={() => {
            if (found && pin) void runCheck(pin, pinMoved ? 'this spot' : found.line1);
          }}
          onTryAnother={() => {
            clearPick(form.getFieldValue('query'));
            setPin(null);
            setMapState('idle');
            setMapView(null);
            requestAnimationFrame(() => {
              const input = document.getElementById(ids.address);
              if (input instanceof HTMLInputElement) {
                input.focus();
                input.select();
              }
            });
          }}
        />

        <form.Field name="line2">
          {(field) => {
            const error = visibleError(field.state.meta, submitted, fieldError(failure, 'line2'));
            return (
              <FieldShell id={ids.line2} label="Apt, suite or floor" optional error={error}>
                {(control) => (
                  <Input
                    {...control}
                    name="line2"
                    autoComplete="address-line2"
                    maxLength={100}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={blurField(field.handleBlur)}
                  />
                )}
              </FieldShell>
            );
          }}
        </form.Field>

        <form.Field name="notes">
          {(field) => (
            <NotesField
              id={ids.notes}
              value={field.state.value}
              error={visibleError(field.state.meta, submitted, fieldError(failure, 'notes'))}
              onChange={(text) => field.handleChange(text)}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>

        <form.Field name="kind">
          {(kindField) => (
            <ChoiceChips
              name={`${id}-kind`}
              legend="Save as"
              choices={KINDS}
              value={kindField.state.value}
              onChange={(next) => {
                kindField.handleChange(next);
                if (next === 'OTHER')
                  setTimeout(() => document.getElementById(ids.label)?.focus(), 0);
              }}
            >
              {kindField.state.value === 'OTHER' ? (
                <form.Field name="label">
                  {(field) => (
                    <FieldShell
                      id={ids.label}
                      label="Name for this address"
                      className="mt-4"
                      error={visibleError(
                        field.state.meta,
                        submitted,
                        fieldError(failure, 'label'),
                      )}
                      more={
                        <p
                          aria-hidden
                          className="mt-1 text-right text-caption text-muted-foreground tabular-nums"
                        >
                          {field.state.value.length}/{LABEL_MAX}
                        </p>
                      }
                    >
                      {(control) => (
                        <Input
                          {...control}
                          name="label"
                          autoComplete="off"
                          maxLength={LABEL_MAX}
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          onBlur={blurField(field.handleBlur)}
                        />
                      )}
                    </FieldShell>
                  )}
                </form.Field>
              ) : null}
            </ChoiceChips>
          )}
        </form.Field>

        <form.Field name="isDefault">
          {(field) => (
            <div>
              <CheckboxRow
                id={ids.isDefault}
                label="Use as my default address"
                checked={field.state.value}
                disabled={defaultLocked}
                describedBy={defaultLocked ? ids.defaultHint : undefined}
                onChange={(checked) => field.handleChange(checked)}
              />
              {defaultLocked ? (
                <p id={ids.defaultHint} className="text-body-5 text-muted-foreground">
                  {firstAddress
                    ? 'Your first address is your default.'
                    : 'To change your default, set another address as default.'}
                </p>
              ) : null}
            </div>
          )}
        </form.Field>
      </div>

      {canSave ? (
        <>
          {blockedReason === 'check' ? (
            <p id={ids.needsCheck} className="mt-8 text-body-5 text-neutral-3">
              {NEEDS_CHECK}
            </p>
          ) : null}
          <div
            className={cn(
              'flex flex-col gap-3 md:flex-row',
              blockedReason === 'check' ? 'mt-3' : 'mt-8',
            )}
          >
            <SubmitButton
              pending={busy}
              pendingLabel="Saving…"
              blocked={blockedReason !== null}
              aria-describedby={
                blockedReason === 'outside'
                  ? DELIVERY_RESULT_ID
                  : blockedReason === 'check'
                    ? ids.needsCheck
                    : undefined
              }
              onBlockedPress={() =>
                announce(delivery.kind === 'outside' ? delivery.text : NEEDS_CHECK)
              }
              className="uppercase md:min-w-44"
            >
              Save address
            </SubmitButton>
            <Button
              asChild
              variant="ghost"
              size="touch"
              className="text-neutral-2 hover:bg-neutral-7"
            >
              <Link href="/account/addresses">Cancel</Link>
            </Button>
          </div>
        </>
      ) : (
        <LockedLine id={ids.locked} className="mt-8">
          The demo account can&apos;t save addresses. Create your own account to save yours.
        </LockedLine>
      )}
    </form>
  );
}

/** "Instructions for the courier": up to 200 characters, with a counter (design 5.4). */
function NotesField({
  id,
  value,
  error,
  onChange,
  onBlur,
}: {
  id: string;
  value: string;
  error: string | null;
  onChange: (text: string) => void;
  onBlur: () => void;
}) {
  useLimitAnnouncer(value.length, NOTES_MAX);
  return (
    <FieldShell
      id={id}
      label="Instructions for the courier"
      optional
      error={error}
      more={
        <p aria-hidden className="mt-1 text-right text-caption text-muted-foreground tabular-nums">
          {value.length}/{NOTES_MAX}
        </p>
      }
    >
      {(control) => (
        <Textarea
          {...control}
          name="notes"
          autoComplete="off"
          maxLength={NOTES_MAX}
          placeholder="Buzzer 3, leave at the door"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={blurField(onBlur)}
          className="min-h-[114px] rounded-xl bg-white px-5 py-2.5 text-body-4 text-neutral-2 md:text-body-4"
        />
      )}
    </FieldShell>
  );
}
