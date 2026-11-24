'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { useSelector } from '@tanstack/react-store';
import { Check, WifiOff } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import {
  GIVE_BACK_REASONS,
  type GiveBackReason,
  giveBackInput,
} from '@/server/modules/delivery/schema';
import { FormAlert } from '@/components/forms/form-alert';
import { SubmitButton } from '@/components/forms/submit-button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { announce } from '@/lib/announce';
import { dispatchStore, giveBackOrder } from '@/lib/partner/dispatch';
import {
  alreadyPickedUpText,
  GIVE_BACK_COPY,
  GIVE_BACK_LABELS,
  giveBackTitle,
  leavingWords,
} from '@/lib/partner/offer-text';

/*
 * Giving an order back (F7 design 1.14, P30): a sheet with one required reason, "Give back"
 * and "Keep the order"; and the dialogs that ask before going offline or signing out while he
 * holds an order. Nothing is given back offline.
 */

const OFFLINE = "You're offline. Connect to give the order back.";

export function GiveBackSheet({
  open,
  orderNumber,
  onOpenChange,
  onDone,
  returnFocus,
}: {
  open: boolean;
  orderNumber: string;
  onOpenChange: (open: boolean) => void;
  /** Given back: Home's idle screen takes over and its h1 takes focus. */
  onDone: () => void;
  returnFocus: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<{ text: string; offline: boolean } | null>(null);
  const finished = useRef(false);

  const form = useForm({
    defaultValues: { reason: '' },
    validationLogic: revalidateLogic({ mode: 'submit', modeAfterSubmission: 'change' }),
    validators: {
      onDynamic: ({ value }) => {
        const parsed = giveBackInput.safeParse(value);
        return parsed.success ? undefined : { fields: { reason: GIVE_BACK_COPY.chooseReason } };
      },
    },
    onSubmitInvalid: () => {
      requestAnimationFrame(() =>
        formRef.current?.querySelector<HTMLElement>('[data-invalid="true"]')?.focus(),
      );
    },
    onSubmit: async ({ value }) => {
      const parsed = giveBackInput.safeParse(value);
      if (!parsed.success || pending) return;
      setPending(true);
      setAlert(null);
      const outcome = await giveBackOrder(parsed.data.reason);
      setPending(false);
      const show = (text: string, offline = false) => {
        setAlert({ text, offline });
        announce(text);
        requestAnimationFrame(() => alertRef.current?.focus());
      };
      switch (outcome) {
        case 'done':
          finished.current = true;
          onOpenChange(false);
          onDone();
          return;
        case 'limit':
          show(GIVE_BACK_COPY.limit);
          return;
        case 'closed':
          finished.current = true;
          announce(alreadyPickedUpText(orderNumber));
          onOpenChange(false);
          onDone();
          return;
        case 'gone':
          finished.current = true;
          onOpenChange(false);
          onDone();
          return;
        case 'offline':
          show(OFFLINE, true);
          return;
        default:
          show('Something went wrong. Please try again.');
      }
    },
  });
  const submitted = useStore(form.store, (state) => state.submissionAttempts > 0);
  const offerOpen = useSelector(dispatchStore, (state) => state.card !== null);

  return (
    <Sheet
      open={open && !offerOpen}
      onOpenChange={(next) => {
        if (!next && pending) return;
        onOpenChange(next);
        if (!next) {
          form.reset();
          setAlert(null);
        }
      }}
    >
      <SheetContent
        className="inset-x-0 bottom-0 mx-auto max-h-[90dvh] max-w-md overflow-y-auto rounded-t-2xl bg-card px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground data-[state=open]:slide-in-from-bottom-6 motion-reduce:data-[state=open]:slide-in-from-bottom-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          finished.current = false;
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!finished.current && !dispatchStore.state.card) returnFocus();
        }}
      >
        <SheetTitle
          ref={titleRef}
          tabIndex={-1}
          className="font-heading text-title-1 text-strong outline-none"
        >
          {giveBackTitle(orderNumber)}
        </SheetTitle>
        <SheetDescription className="sr-only">{GIVE_BACK_COPY.line}</SheetDescription>
        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
          className="mt-4"
        >
          <div ref={alertRef} tabIndex={-1} className="outline-none">
            {alert ? (
              <FormAlert
                variant={alert.offline ? 'info' : 'error'}
                tone="partner"
                icon={alert.offline ? WifiOff : undefined}
                className="mb-4"
              >
                {alert.text}
              </FormAlert>
            ) : null}
          </div>
          <form.Field name="reason">
            {(field) => {
              const first = field.state.meta.errors.find((error) => typeof error === 'string');
              const error = submitted && typeof first === 'string' ? first : null;
              const errorId = error ? `${id}-error` : undefined;
              return (
                <fieldset
                  aria-describedby={errorId}
                  className="min-w-0"
                  inert={pending || undefined}
                >
                  <legend className="text-body-4 font-medium text-strong">
                    {GIVE_BACK_COPY.legend}
                  </legend>
                  <div className="mt-2 space-y-2">
                    {GIVE_BACK_REASONS.map((reason: GiveBackReason, index) => (
                      <label
                        key={reason}
                        className="group flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-input bg-card px-4 text-body-4 text-strong has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-success-soft has-[:checked]:px-[15px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid"
                      >
                        <input
                          type="radio"
                          name="give-back-reason"
                          value={reason}
                          checked={field.state.value === reason}
                          onChange={() => field.handleChange(reason)}
                          data-invalid={error && index === 0 ? 'true' : undefined}
                          className="size-5 shrink-0 accent-primary outline-none"
                        />
                        <span className="flex-1">{GIVE_BACK_LABELS[reason]}</span>
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
            }}
          </form.Field>
          <p className="mt-4 text-body-4 text-foreground">{GIVE_BACK_COPY.line}</p>
          <div className="mt-6 flex flex-col gap-3">
            <SubmitButton
              size="dock"
              variant="danger"
              pending={pending}
              pendingLabel={GIVE_BACK_COPY.pending}
            >
              {GIVE_BACK_COPY.action}
            </SubmitButton>
            <Button
              type="button"
              variant="outline"
              size="kitchen"
              aria-disabled={pending || undefined}
              className="w-full bg-card text-strong"
              onClick={() => {
                if (!pending) onOpenChange(false);
              }}
            >
              {GIVE_BACK_COPY.keep}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/**
 * "You have order 1042" (P30.4): before going offline or signing out while he holds an order.
 * "Keep the order" is the first focus; the action gives it back, then does what he asked.
 */
export function LeavingDialog({
  open,
  orderNumber,
  how,
  onKeep,
  onConfirm,
  returnFocus,
}: {
  open: boolean;
  orderNumber: string;
  how: 'offline' | 'signOut';
  onKeep: () => void;
  /** Resolves when done; a refusal leaves the dialog open with the reason announced. */
  onConfirm: () => Promise<string | null>;
  returnFocus: () => void;
}) {
  const words = leavingWords(orderNumber, how);
  const keepRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const offerOpen = useSelector(dispatchStore, (state) => state.card !== null);
  return (
    <AlertDialog
      open={open && !offerOpen}
      onOpenChange={(next) => {
        if (!next && !pending) onKeep();
      }}
    >
      <AlertDialogContent
        className="border border-border bg-card text-foreground"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          setRefusal(null);
          keepRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!dispatchStore.state.card) returnFocus();
        }}
      >
        <AlertDialogTitle className="font-heading text-title-2 text-strong">
          {words.title}
        </AlertDialogTitle>
        <AlertDialogDescription className="mt-3 text-body-4 text-foreground">
          {words.description}
        </AlertDialogDescription>
        {refusal ? (
          <FormAlert variant="error" tone="partner" className="mt-4">
            {refusal}
          </FormAlert>
        ) : null}
        <div className="mt-6 flex flex-col gap-3">
          <Button
            ref={keepRef}
            type="button"
            variant="outline"
            size="kitchen"
            aria-disabled={pending || undefined}
            className="w-full bg-card text-strong"
            onClick={() => {
              if (!pending) onKeep();
            }}
          >
            {words.keep}
          </Button>
          <SubmitButton
            type="button"
            size="kitchen"
            variant="stop"
            pending={pending}
            pendingLabel={words.pending}
            className="w-full"
            onClick={() => {
              setPending(true);
              setRefusal(null);
              void (async () => {
                const problem = await onConfirm();
                setPending(false);
                if (problem) {
                  setRefusal(problem);
                  announce(problem);
                }
              })();
            }}
          >
            {words.action}
          </SubmitButton>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
