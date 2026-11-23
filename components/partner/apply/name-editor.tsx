'use client';

import { useId, useRef, useState } from 'react';
import { updateProfileAction } from '@/server/modules/account/actions';
import { nameSchema } from '@/server/modules/account/schema';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { DEFAULT_PHONE_COUNTRY } from '@/lib/phone';
import { cnInput, PartnerField } from './fields';

/*
 * The name, edited in place (F6 design 4.3, 4.7.3): the account's name by F2's rules, without
 * leaving the application. It isn't a form of its own (the application is), so Enter saves the
 * name instead of sending the step.
 */

export function InlineNameEditor({
  name,
  accountPhone,
  onSaved,
  hint,
  compact = false,
}: {
  name: string;
  /** Sent back unchanged with the name, so saving a name never touches the phone. */
  accountPhone: { display: string; country: string | null } | null;
  onSaved: (name: string) => void;
  hint: string;
  /** Step 4's card: the hint and an "Edit name" link-button under the name. */
  compact?: boolean;
}) {
  const id = useId();
  const editRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const close = () => {
    setOpen(false);
    setError(null);
    requestAnimationFrame(() => editRef.current?.focus());
  };

  const save = async () => {
    if (pending) return;
    const parsed = nameSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter your name.');
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    setPending(true);
    const outcome = await callAction(() =>
      updateProfileAction({
        name: parsed.data,
        phone: accountPhone?.display ?? '',
        phoneCountry: accountPhone?.country ?? DEFAULT_PHONE_COUNTRY,
      }),
    );
    setPending(false);
    if (outcome.ok) {
      onSaved(outcome.data.name);
      announce('Name saved');
      close();
      return;
    }
    setError(outcome.error.fieldErrors?.name?.[0] ?? outcome.error.message);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const editButton = compact ? (
    <button
      ref={editRef}
      type="button"
      aria-expanded={open}
      onClick={() => {
        setValue(name);
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }}
      className="inline-flex h-12 items-center text-button-2 font-medium text-primary underline underline-offset-4"
    >
      Edit name
    </button>
  ) : (
    <Button
      ref={editRef}
      type="button"
      variant="ghost"
      size="kitchen"
      aria-expanded={open}
      className="-mr-3 text-strong"
      onClick={() => {
        setValue(name);
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }}
    >
      Edit<span className="sr-only"> name</span>
    </Button>
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {compact ? (
        <>
          <p className="mt-1 text-body-5 text-muted-foreground">{hint}</p>
          {open ? null : editButton}
        </>
      ) : (
        <div>
          <p className="text-body-4 font-medium text-strong">Name</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-body-3 font-medium text-strong [overflow-wrap:anywhere]">{name}</p>
            {open ? null : editButton}
          </div>
          <p className="mt-2 text-body-5 text-muted-foreground">{hint}</p>
        </div>
      )}
      <CollapsibleContent className="mt-3">
        <PartnerField id={`${id}-name`} label="Name" error={error}>
          {(control) => (
            <input
              {...control}
              ref={inputRef}
              autoComplete="name"
              autoCapitalize="words"
              maxLength={60}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void save();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  close();
                }
              }}
              className={cnInput()}
            />
          )}
        </PartnerField>
        <div className="mt-3 flex gap-2">
          <SubmitButton
            type="button"
            variant="outline"
            size="kitchen"
            pending={pending}
            pendingLabel="Saving…"
            onClick={() => void save()}
          >
            Save name
          </SubmitButton>
          <Button
            type="button"
            variant="ghost"
            size="kitchen"
            className="text-strong"
            onClick={close}
          >
            Cancel
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
